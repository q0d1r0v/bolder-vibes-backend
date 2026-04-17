import {
  Injectable,
  Inject,
  Logger,
  forwardRef,
  BadRequestException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RedisService } from '@/redis/redis.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { EventsGateway } from '@/gateway/events.gateway.js';
import {
  NativePreviewState,
  PreviewStatus,
  BV_EXPO_IMAGE,
} from './preview.interface.js';
import { upgradeProjectToTargetSdk, TARGET_EXPO_SDK } from './sdk-upgrade.js';

const execFileAsync = promisify(execFile);

/** Port inside the container for the Metro bundler in tunnel mode. */
const METRO_TUNNEL_PORT = 8081;

/** Redis TTL — 1 hour. Tunnels are expensive to hold open. */
const REDIS_TTL_SECONDS = 3600;

/** Max time we will wait for `exp://` URL to appear in container logs.
 *  First run needs to install @expo/ngrok (~5 MB) + establish tunnel, so
 *  we allow up to 4 minutes before giving up. */
const TUNNEL_READY_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * NativePreviewService manages a dedicated `expo start --tunnel` container
 * per project so a user's real phone (running Expo Go) can connect to the
 * Metro bundler over the public internet.
 *
 * This is kept separate from the existing web `PreviewService` so both
 * previews can run concurrently for the same project without stepping on
 * each other's container state.
 */
@Injectable()
export class NativePreviewService implements OnApplicationShutdown {
  private readonly logger = new Logger(NativePreviewService.name);
  private readonly starting = new Set<string>();
  /** Active log-streaming child processes keyed by projectId. */
  private readonly logStreams = new Map<string, { kill: () => void }>();

  /** Best-effort cleanup on SIGTERM: stop every tunnel container spawned
   *  by this service so no orphaned `expo start --tunnel` processes are
   *  left holding ports after a backend restart. */
  async onApplicationShutdown(): Promise<void> {
    const projectIds = new Set<string>([
      ...this.starting,
      ...this.logStreams.keys(),
    ]);
    if (projectIds.size === 0) return;
    this.logger.log(
      `Shutdown: stopping ${projectIds.size} native preview container(s)`,
    );
    for (const [, stream] of this.logStreams) {
      try {
        stream.kill();
      } catch {
        /* ignore */
      }
    }
    this.logStreams.clear();
    await Promise.allSettled(
      [...projectIds].map((projectId) =>
        this.forceRemoveContainer(this.getContainerName(projectId)),
      ),
    );
    this.starting.clear();
  }

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly gateway: EventsGateway,
  ) {}

  private getContainerName(projectId: string): string {
    return `bv-preview-native-${projectId.replace(/-/g, '')}`;
  }

  private getWorkDir(projectId: string): string {
    return path.join(
      os.tmpdir(),
      `bv-preview-native-${projectId.replace(/-/g, '')}`,
    );
  }

  async getStatus(projectId: string): Promise<NativePreviewState> {
    const raw = await this.redis.get(`preview:native:${projectId}`);
    if (!raw) {
      return { projectId, status: PreviewStatus.IDLE };
    }
    return JSON.parse(raw) as NativePreviewState;
  }

  /**
   * Write a single file into the running tunnel container's workDir so
   * Metro's file watcher picks it up and hot-reloads connected Expo Go
   * clients. Mirrors {@link PreviewService.syncFile} but targets the
   * native-preview workDir. Intentionally does NOT run `npm install` or
   * other post-sync side effects — those would kill the tunnel state.
   *
   * We allow writes while the container is still BUILDING because the
   * bind mount is active from the moment the container starts, so
   * queued writes are picked up by Metro's first watch cycle.
   */
  async syncFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    // Source-of-truth check: does the workDir actually exist on disk?
    // We deliberately DO NOT gate on Redis state, because:
    //   - the Redis key has a 1-hour TTL and may expire while the
    //     container keeps running (observed in production),
    //   - backend restarts wipe the in-memory view of who's running,
    //   - a stale ERROR state in Redis (e.g. container briefly failed
    //     health check) doesn't mean the file-write would hurt anyone.
    // If the directory exists we write — Metro's watcher will pick it
    // up if it's there, and if it isn't, a later preview start will
    // read the freshest files anyway.
    const workDir = this.getWorkDir(projectId);
    const dirExists = await fs
      .stat(workDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!dirExists) {
      this.logger.debug(`Skip native sync for ${projectId}: workDir missing`);
      return;
    }

    const fullPath = path.join(workDir, filePath);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
      this.logger.debug(`Synced file to native preview: ${filePath}`);
    } catch (err) {
      this.logger.warn(
        `Failed to sync ${filePath} to native preview for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Remove a single file from the tunnel container's workDir so Metro
   * picks up the deletion. Gated only by workDir existence for the
   * same reason as syncFile above.
   */
  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const workDir = this.getWorkDir(projectId);
    const dirExists = await fs
      .stat(workDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!dirExists) return;
    const fullPath = path.join(workDir, filePath);
    try {
      await fs.unlink(fullPath);
      this.logger.debug(`Deleted file in native preview: ${filePath}`);
    } catch {
      /* file may not exist on disk — that's fine */
    }
  }

  async start(projectId: string): Promise<NativePreviewState> {
    if (this.starting.has(projectId)) {
      throw new BadRequestException(
        'A native preview is already starting for this project.',
      );
    }

    // If an existing container is already running, just return its state.
    const current = await this.getStatus(projectId);
    if (
      current.status === PreviewStatus.BUILDING ||
      current.status === PreviewStatus.READY
    ) {
      return current;
    }

    const state: NativePreviewState = {
      projectId,
      status: PreviewStatus.BUILDING,
      startedAt: new Date(),
    };
    await this.redis.set(
      `preview:native:${projectId}`,
      JSON.stringify(state),
      'EX',
      REDIS_TTL_SECONDS,
    );
    this.gateway.emitToProject(projectId, 'preview:native_starting', {
      projectId,
    });
    this.starting.add(projectId);

    this.runStart(projectId)
      .catch(async (err) => {
        const msg =
          err instanceof Error ? err.message : 'Native preview failed';
        this.logger.error(`Native preview failed for ${projectId}: ${msg}`);
        await this.markError(projectId, msg);
        try {
          await this.forceRemoveContainer(this.getContainerName(projectId));
        } catch {
          /* ignore */
        }
      })
      .finally(() => {
        this.starting.delete(projectId);
      });

    return state;
  }

  async stop(projectId: string): Promise<void> {
    this.starting.delete(projectId);

    const stream = this.logStreams.get(projectId);
    if (stream) {
      try {
        stream.kill();
      } catch {
        /* ignore */
      }
      this.logStreams.delete(projectId);
    }

    await this.redis.del(`preview:native:${projectId}`);
    await this.forceRemoveContainer(this.getContainerName(projectId));

    const workDir = this.getWorkDir(projectId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      try {
        await execFileAsync(
          'docker',
          [
            'run',
            '--rm',
            '-v',
            `${workDir}:/cleanup`,
            'node:20-alpine',
            'sh',
            '-c',
            'rm -rf /cleanup/*',
          ],
          { timeout: 15000 },
        );
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }

    this.gateway.emitToProject(projectId, 'preview:native_stopped', {
      projectId,
    });
    this.logger.log(`Native preview stopped for ${projectId}`);
  }

  private async runStart(projectId: string): Promise<void> {
    // 1. Fetch files from Prisma.
    const files = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (files.length === 0) {
      throw new Error(
        'Project has no files — seed a template first by opening the project.',
      );
    }

    // 2. Write files to a dedicated temp dir (isolated from web preview).
    const workDir = this.getWorkDir(projectId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o700);
    for (const f of files) {
      const full = path.join(workDir, f.path);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content);
    }

    // 2b. Migrate existing projects to the current Expo SDK so Expo Go
    //     on the user's phone (which only runs one SDK at a time)
    //     accepts the manifest. No-op when package.json is already on
    //     the target SDK.
    const upgraded = await upgradeProjectToTargetSdk(workDir);
    if (upgraded) {
      this.logger.log(
        `Rewrote package.json to Expo SDK ${TARGET_EXPO_SDK} for ${projectId}`,
      );
    }

    // 3. Ensure the base image is available.
    try {
      await execFileAsync('docker', ['image', 'inspect', BV_EXPO_IMAGE], {
        timeout: 5000,
      });
    } catch {
      throw new Error(
        `Docker image "${BV_EXPO_IMAGE}" not found locally. Build it first: ` +
          `bash bolder-vibes-backend/docker/expo-preview/build.sh`,
      );
    }

    // 4. Remove stale container.
    const containerName = this.getContainerName(projectId);
    await this.forceRemoveContainer(containerName);

    // 5. Start the container detached. @expo/ngrok is installed globally
    //    in the image, so `expo start --tunnel` can open a public URL.
    //
    //    We reuse the EXPO_INSTALL guard via a small inline variant — we
    //    cannot import the internal constant since it references baked
    //    state. Instead we run `npm install --prefer-offline` which will
    //    no-op when deps are already in place from a prior build.
    // Note: @expo/ngrok is required for tunnel mode. We install it at
    // runtime if missing so this code path works even on a pre-existing
    // bv-expo-preview image that was built before the ngrok layer was
    // added to the Dockerfile. On an updated image this step is a no-op.
    const command = [
      'if [ -L /app/node_modules ]; then rm /app/node_modules; fi',
      'if [ ! -d /app/node_modules ] && [ -d /bv-meta/node_modules ]; then' +
        ' cp -a /bv-meta/node_modules /app/node_modules; fi',
      // --legacy-peer-deps so AI-generated drift across expo-* versions
      // doesn't ERESOLVE-block the tunnel from starting.
      'npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund',
      // Re-pin every `expo-*` dep to the SDK the installed `expo` CLI
      // expects. Without this the baked node_modules (pre-compiled for
      // the older SDK) can shadow the newer `expo` package and Metro
      // will serve a mismatched manifest.
      'echo "[bv] expo install --fix (align expo-* deps with SDK)..."',
      './node_modules/.bin/expo install --fix < /dev/null || true',
      'if ! npm list -g @expo/ngrok >/dev/null 2>&1; then' +
        ' echo "[bv] installing @expo/ngrok for tunnel support..." &&' +
        ' npm install -g @expo/ngrok@^4.1.0 --silent; fi',
      'echo "[bv] starting expo tunnel..."',
      // IMPORTANT for live HMR:
      //   - No `CI=1` — it disables Metro's watcher.
      //   - CHOKIDAR_USEPOLLING + WATCHPACK_POLLING force polling; the
      //     Linux inotify kernel events do NOT cross Docker bind-mount
      //     boundaries, so without polling our `syncFile` writes are
      //     invisible to Metro and changes only appear after a manual
      //     Stop → Start.
      //   - stdin closed via `< /dev/null` + `--non-interactive` so
      //     Metro never hangs on prompts.
      'unset CI && CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=300 WATCHPACK_POLLING=300 EXPO_NO_TELEMETRY=1 npx expo start --tunnel --port 8081 --clear < /dev/null',
    ].join(' && ');

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--memory',
      '2048m',
      '--cpus',
      '2',
      '-v',
      `${workDir}:/app`,
      '-v',
      'bv-npm-cache:/root/.npm',
      '-v',
      'bv-metro-cache-v1:/root/.metro-cache',
      '-w',
      '/app',
      '-p',
      `0:${METRO_TUNNEL_PORT}`,
      BV_EXPO_IMAGE,
      'sh',
      '-c',
      command,
    ];

    await execFileAsync('docker', args, { timeout: 30_000 });
    this.logger.log(`Native preview container started: ${containerName}`);

    // 6. Start streaming logs. Expo CLI in CI/non-interactive mode does
    //    NOT print the `exp://` URL to stdout — we have to fetch it from
    //    the running dev server's manifest endpoint (/ with header
    //    `exponent-platform: ios` returns JSON with `hostUri`). Once
    //    "Tunnel ready" appears in the logs, we `docker exec curl` into
    //    the container to read the manifest and build `exp://<hostUri>`.
    let expoUrl: string | null = null;
    let resolving = false;

    const resolveTunnelUrl = async (): Promise<void> => {
      if (expoUrl || resolving) return;
      resolving = true;
      try {
        // Retry up to ~15 seconds — on first boot the tunnel can be
        // "ready" a moment before the manifest endpoint serves the
        // correct hostUri.
        for (let i = 0; i < 15; i++) {
          try {
            const { stdout } = await execFileAsync(
              'docker',
              [
                'exec',
                containerName,
                'sh',
                '-c',
                'which curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1; ' +
                  'curl -sS -H "exponent-platform: ios" http://localhost:8081/',
              ],
              { timeout: 10_000 },
            );
            const match = stdout.match(/"hostUri"\s*:\s*"([^"]+)"/);
            const host = match?.[1];
            if (
              host &&
              !host.startsWith('127.') &&
              !host.startsWith('localhost')
            ) {
              expoUrl = `exp://${host}`;
              await this.markReady(projectId, expoUrl);
              return;
            }
          } catch {
            /* container may not be fully ready yet */
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        resolving = false;
      }
    };

    const child = spawn('docker', [
      'logs',
      '-f',
      '--tail',
      '200',
      containerName,
    ]);

    const onData = (data: Buffer) => {
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        // Forward build output to the same sandbox:log channel that the
        // preview-logs panel subscribes to so the user can see progress.
        this.gateway.emitToProject(projectId, 'sandbox:log', {
          projectId,
          line,
          timestamp: new Date().toISOString(),
        });

        if (!expoUrl && /Tunnel ready|Waiting on http/i.test(line)) {
          void resolveTunnelUrl();
        }
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', () => {
      this.logStreams.delete(projectId);
      // If the log stream ended without ever producing an `exp://` URL,
      // the container exited (crashed or stopped). Mark error so the UI
      // doesn't sit on "Starting tunnel…" forever.
      if (!expoUrl) {
        void (async () => {
          const state = await this.getStatus(projectId);
          if (state.status === PreviewStatus.READY) return;
          await this.markError(
            projectId,
            'Tunnel container exited before becoming ready. Check the Logs tab for details.',
          );
          await this.forceRemoveContainer(containerName);
        })();
      }
    });
    this.logStreams.set(projectId, {
      kill: () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      },
    });

    // 7. Fail-safe timeout — if no URL appears, mark error.
    setTimeout(() => {
      if (expoUrl) return;
      void (async () => {
        const state = await this.getStatus(projectId);
        if (state.status === PreviewStatus.READY) return;
        await this.markError(
          projectId,
          'Tunnel did not become ready in time. The Expo tunnel service may be unreachable from this host.',
        );
        await this.forceRemoveContainer(containerName);
      })();
    }, TUNNEL_READY_TIMEOUT_MS);
  }

  private async markReady(projectId: string, expoUrl: string): Promise<void> {
    const state: NativePreviewState = {
      projectId,
      status: PreviewStatus.READY,
      expoUrl,
    };
    await this.redis.set(
      `preview:native:${projectId}`,
      JSON.stringify(state),
      'EX',
      REDIS_TTL_SECONDS,
    );
    this.gateway.emitToProject(projectId, 'preview:native_ready', {
      projectId,
      expoUrl,
    });
    this.logger.log(`Native preview ready for ${projectId}: ${expoUrl}`);
  }

  private async markError(projectId: string, error: string): Promise<void> {
    const state: NativePreviewState = {
      projectId,
      status: PreviewStatus.ERROR,
      error,
    };
    await this.redis.set(
      `preview:native:${projectId}`,
      JSON.stringify(state),
      'EX',
      REDIS_TTL_SECONDS,
    );
    this.gateway.emitToProject(projectId, 'preview:native_error', {
      projectId,
      error,
    });
  }

  private async forceRemoveContainer(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['stop', name], { timeout: 10000 });
    } catch {
      /* ignore */
    }
    try {
      await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 });
    } catch {
      /* ignore */
    }
  }
}
