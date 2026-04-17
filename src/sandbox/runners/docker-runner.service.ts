import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'net';
import {
  ExecutionResult,
  SandboxConfig,
  DEFAULT_SANDBOX_CONFIG,
} from '../sandbox.interface.js';
import { Runner } from './runner.interface.js';
import { sanitizeCommand } from '../command-sanitizer.js';

const execFileAsync = promisify(execFile);

/**
 * Generates a deterministic but collision-safe container suffix from projectId.
 * Uses full UUID (hyphens removed) to prevent cross-project collisions.
 */
function containerSuffix(projectId: string): string {
  return projectId.replace(/-/g, '');
}

@Injectable()
export class DockerRunnerService implements Runner {
  private readonly logger = new Logger(DockerRunnerService.name);

  // Track active log streams so we can clean them up
  private readonly activeLogStreams = new Map<string, { stop: () => void }>();

  async execute(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult> {
    const sanitization = sanitizeCommand(command);
    if (!sanitization.isValid) {
      throw new BadRequestException(sanitization.error);
    }

    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const suffix = containerSuffix(projectId);
    const containerName = `bv-sandbox-${suffix}`;
    const start = Date.now();

    try {
      const args = [
        'run',
        '--rm',
        '--name',
        containerName,
        '--memory',
        `${cfg.maxMemoryMb}m`,
        '--cpus',
        `${cfg.maxCpuPercent / 100}`,
        ...(cfg.networkEnabled ? [] : ['--network', 'none']),
        '--read-only',
        '--tmpfs',
        '/tmp:rw,size=100m',
        'node:20-alpine',
        'sh',
        '-c',
        command,
      ];

      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: cfg.timeoutMs,
      });

      return {
        stdout,
        stderr,
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      return {
        stdout: (err.stdout as string) || '',
        stderr:
          (err.stderr as string) || (err.message as string) || 'Unknown error',
        exitCode: (err.code as number) || 1,
        durationMs: Date.now() - start,
      };
    }
  }

  async startLongRunning(
    projectId: string,
    workDir: string,
    command: string,
    config?: Partial<SandboxConfig>,
    containerPort?: number,
  ): Promise<{ containerId: string; port: number; reused?: boolean }> {
    const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    const image = cfg.image ?? 'node:20-alpine';

    // Phase 3 — container reuse. If a container is already running for
    // this project AND the labels show it was created with the same image
    // and same package.json SHA, just return its existing host port.
    // Subsequent "Start Preview" clicks become ~0s instead of 20s.
    const existing = await this.inspectContainer(containerName);
    if (
      existing &&
      existing.running &&
      existing.labels.bv_project_id === projectId &&
      existing.labels.bv_image === image &&
      (!cfg.labels?.bv_pkg_sha ||
        existing.labels.bv_pkg_sha === cfg.labels.bv_pkg_sha) &&
      existing.port
    ) {
      this.logger.log(
        `Reusing preview container ${containerName} on port ${existing.port} (bv_pkg_sha=${existing.labels.bv_pkg_sha ?? 'n/a'})`,
      );
      return {
        containerId: existing.id,
        port: existing.port,
        reused: true,
      };
    }

    // Not reusable — tear down the old one (if any) and rebuild.
    await this.forceRemoveContainer(containerName);

    const hostPort = await this.findAvailablePort();

    // Ensure the configured image exists locally. For our custom
    // `bv-expo-preview:*` images we do NOT fall back to `docker pull`
    // because they are built locally via docker/expo-preview/build.sh.
    // Surface a clear error so the operator knows what to do.
    try {
      await execFileAsync('docker', ['image', 'inspect', image], {
        timeout: 5000,
      });
    } catch {
      if (image.startsWith('bv-')) {
        throw new Error(
          `Docker image "${image}" not found locally. Build it first: ` +
            `bash bolder-vibes-backend/docker/expo-preview/build.sh`,
        );
      }
      this.logger.log(`Pulling ${image}...`);
      await execFileAsync('docker', ['pull', image], { timeout: 300000 });
    }

    // Build env var flags
    const envFlags: string[] = [];
    if (cfg.envVars) {
      for (const [key, value] of Object.entries(cfg.envVars)) {
        envFlags.push('-e', `${key}=${value}`);
      }
    }

    // Build label flags — used by the reuse check above and for operator
    // debugging (`docker inspect`).
    const labelFlags: string[] = [
      '--label',
      `bv_project_id=${projectId}`,
      '--label',
      `bv_image=${image}`,
    ];
    if (cfg.labels) {
      for (const [key, value] of Object.entries(cfg.labels)) {
        labelFlags.push('--label', `${key}=${value}`);
      }
    }

    // Ensure shared cache volumes exist (created once, reused by all containers)
    await this.ensureNpmCacheVolume();

    // Volume wiring:
    //   - /root/.npm: npm tarball cache (small packages users add on top)
    //   - /root/.metro-cache: Metro transform cache — seeded from the
    //     baked image layer on first container, persisted across restarts.
    //     Versioned name (`-v1`) so we can invalidate without dropping the
    //     npm cache by rebuilding the base image with a new volume tag.
    //   - NO mount on /app/node_modules — the bv-expo-preview image
    //     provides it in its own layer, and a volume mount there would
    //     mask the baked node_modules. That is the entire point.
    const volumeFlags: string[] = [
      '-v',
      `${workDir}:/app`,
      '-v',
      'bv-npm-cache:/root/.npm',
    ];
    if (image.startsWith('bv-expo-preview')) {
      volumeFlags.push('-v', 'bv-metro-cache-v1:/root/.metro-cache');
    } else {
      // Legacy fallback: when running on raw node:20-alpine (e.g. tests or
      // a transitional deployment), keep the old node_modules volume so
      // npm install still benefits from cross-container caching.
      volumeFlags.push('-v', 'bv-expo-modules:/app/node_modules');
    }

    // Start on the default bridge network (internet access for apk/npm).
    // If a custom docker network is needed (e.g. for database), we connect
    // the container to it AFTER startup so it has both internet + DB access.
    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--memory',
      `${cfg.maxMemoryMb}m`,
      '--cpus',
      `${cfg.maxCpuPercent / 100}`,
      ...envFlags,
      ...labelFlags,
      ...volumeFlags,
      '-w',
      '/app',
      '-p',
      `${hostPort}:${containerPort ?? 3000}`,
      image,
      'sh',
      '-c',
      command,
    ];

    const { stdout } = await execFileAsync('docker', args, {
      timeout: cfg.timeoutMs,
    });

    // Connect to the custom network (for DB access) while keeping the
    // default bridge network (for internet/apk/npm).
    if (cfg.dockerNetwork) {
      await execFileAsync(
        'docker',
        ['network', 'connect', cfg.dockerNetwork, containerName],
        { timeout: 10000 },
      );
    }

    this.logger.log(
      `Preview container started: ${containerName} on port ${hostPort} (image=${image})`,
    );

    return { containerId: stdout.trim(), port: hostPort };
  }

  async containerExists(projectId: string): Promise<boolean> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    try {
      await execFileAsync(
        'docker',
        ['inspect', '--format', '{{.State.Running}}', containerName],
        { timeout: 5000 },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inspect a container by name and return its running state, first-mapped
   * host port, and labels. Returns `null` if the container does not exist.
   * Used by `startLongRunning()` to decide whether an existing container
   * can be reused instead of destroyed and rebuilt.
   */
  private async inspectContainer(name: string): Promise<{
    id: string;
    running: boolean;
    port: number | null;
    labels: Record<string, string>;
  } | null> {
    try {
      const { stdout } = await execFileAsync('docker', ['inspect', name], {
        timeout: 5000,
      });
      const data = JSON.parse(stdout) as Array<{
        Id: string;
        State: { Running: boolean };
        Config: { Labels: Record<string, string> | null };
        NetworkSettings: {
          Ports: Record<
            string,
            Array<{ HostIp: string; HostPort: string }> | null
          >;
        };
      }>;
      if (!data.length) return null;
      const c = data[0];
      const labels = c.Config.Labels ?? {};

      // Extract the first published host port (we only ever publish one).
      let port: number | null = null;
      const ports = c.NetworkSettings.Ports ?? {};
      for (const bindings of Object.values(ports)) {
        if (bindings && bindings.length) {
          const p = parseInt(bindings[0].HostPort, 10);
          if (Number.isFinite(p)) {
            port = p;
            break;
          }
        }
      }

      return {
        id: c.Id,
        running: c.State.Running,
        port,
        labels,
      };
    } catch {
      return null;
    }
  }

  private async forceRemoveContainer(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['stop', name], { timeout: 10000 });
    } catch {
      // Container may not exist or already stopped
    }
    try {
      await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 });
    } catch {
      // Container may not exist
    }
  }

  async execInContainer(
    projectId: string,
    command: string,
    timeoutMs = 120000,
  ): Promise<{ stdout: string; stderr: string }> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', containerName, 'sh', '-c', command],
        { timeout: timeoutMs },
      );
      this.logger.log(
        `Exec in container ${containerName}: ${command.slice(0, 50)}`,
      );
      return { stdout, stderr };
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      this.logger.warn(
        `Exec failed in ${containerName}: ${(err.stderr as string) || (err.message as string) || 'Unknown error'}`,
      );
      return {
        stdout: (err.stdout as string) || '',
        stderr:
          (err.stderr as string) || (err.message as string) || 'Unknown error',
      };
    }
  }

  /**
   * Stream container logs in real-time via `docker logs -f`.
   * Returns a handle to stop streaming.
   */
  streamLogs(
    projectId: string,
    onLog: (line: string) => void,
  ): { stop: () => void } {
    // Stop any existing stream for this project
    this.stopLogStream(projectId);

    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;

    const child = spawn('docker', [
      'logs',
      '-f',
      '--tail',
      '100',
      containerName,
    ]);

    const handleData = (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onLog(line);
        }
      }
    };

    child.stdout.on('data', handleData);
    child.stderr.on('data', handleData);

    child.on('error', (err) => {
      this.logger.debug(
        `Log stream error for ${containerName}: ${err.message}`,
      );
    });

    child.on('close', () => {
      this.activeLogStreams.delete(projectId);
    });

    const handle = {
      stop: () => {
        child.kill();
        this.activeLogStreams.delete(projectId);
      },
    };

    this.activeLogStreams.set(projectId, handle);
    return handle;
  }

  private stopLogStream(projectId: string): void {
    const existing = this.activeLogStreams.get(projectId);
    if (existing) {
      existing.stop();
    }
  }

  async getContainerLogs(projectId: string): Promise<string> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-preview-${suffix}`;
    try {
      const { stdout, stderr } = await execFileAsync('docker', [
        'logs',
        '--tail',
        '100',
        containerName,
      ]);
      return stdout + stderr;
    } catch {
      return '';
    }
  }

  async cleanup(projectId: string): Promise<void> {
    // Stop log streaming first
    this.stopLogStream(projectId);

    const suffix = containerSuffix(projectId);
    const sandboxName = `bv-sandbox-${suffix}`;
    const previewName = `bv-preview-${suffix}`;
    for (const name of [sandboxName, previewName]) {
      await this.forceRemoveContainer(name);
    }
    // Also clean up database container and network
    await this.stopDatabase(projectId);
    await this.removeNetwork(`bv-net-${suffix}`);
  }

  async createNetwork(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'create', name], {
        timeout: 10000,
      });
      this.logger.log(`Docker network created: ${name}`);
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      const stderr = (err.stderr as string) || '';
      if (!stderr.includes('already exists')) {
        throw error;
      }
      this.logger.debug(`Docker network already exists: ${name}`);
    }
  }

  async removeNetwork(name: string): Promise<void> {
    try {
      await execFileAsync('docker', ['network', 'rm', name], {
        timeout: 10000,
      });
      this.logger.log(`Docker network removed: ${name}`);
    } catch {
      // Network may not exist
    }
  }

  async startDatabase(
    projectId: string,
    networkName: string,
    dbPassword?: string,
  ): Promise<{ containerId: string }> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-db-${suffix}`;
    const password = dbPassword || 'postgres';

    await this.forceRemoveContainer(containerName);

    // Pull postgres image if not present
    try {
      await execFileAsync('docker', ['image', 'inspect', 'postgres:16-alpine']);
    } catch {
      this.logger.log('Pulling postgres:16-alpine image...');
      await execFileAsync('docker', ['pull', 'postgres:16-alpine'], {
        timeout: 300000,
      });
    }

    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      networkName,
      '--memory',
      '256m',
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=app',
      'postgres:16-alpine',
    ];

    const { stdout } = await execFileAsync('docker', args, {
      timeout: 30000,
    });

    this.logger.log(`Database container started: ${containerName}`);
    return { containerId: stdout.trim() };
  }

  async stopDatabase(projectId: string): Promise<void> {
    const suffix = containerSuffix(projectId);
    const containerName = `bv-db-${suffix}`;
    await this.forceRemoveContainer(containerName);
  }

  /**
   * Create the shared npm cache Docker volume if it doesn't already exist.
   * This volume is mounted into every preview container at /root/.npm,
   * so npm install reuses cached packages across all users' previews.
   * Cuts subsequent npm installs from minutes to seconds.
   */
  private async ensureNpmCacheVolume(): Promise<void> {
    // bv-npm-cache     : npm tarball cache (all containers)
    // bv-metro-cache-v1: Metro transform cache, seeded from the baked
    //                    bv-expo-preview image on first use. Versioned
    //                    so we can invalidate it by bumping the suffix
    //                    when the base image's baked cache changes.
    // bv-expo-modules  : legacy node_modules volume, kept only for
    //                    non-bv-expo-preview images (fallback path).
    for (const vol of [
      'bv-npm-cache',
      'bv-metro-cache-v1',
      'bv-expo-modules',
    ]) {
      try {
        await execFileAsync('docker', ['volume', 'inspect', vol], {
          timeout: 5000,
        });
      } catch {
        await execFileAsync('docker', ['volume', 'create', vol], {
          timeout: 5000,
        });
        this.logger.log(`Created shared volume: ${vol}`);
      }
    }
  }

  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() =>
            reject(new Error('Could not find available port')),
          );
        }
      });
      server.on('error', reject);
    });
  }
}
