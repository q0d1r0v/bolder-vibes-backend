import {
  Injectable,
  Inject,
  Logger,
  forwardRef,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { EventsGateway } from '@/gateway/events.gateway.js';
import { RUNNER_TOKEN } from '../runners/runner.interface.js';
import type { Runner } from '../runners/runner.interface.js';
import { TemplatesService } from '@/projects/templates/templates.service.js';
import {
  PreviewStatus,
  PreviewState,
  FRAMEWORK_CONFIGS,
  PROXY_SCRIPT,
} from './preview.interface.js';
import { upgradeProjectToTargetSdk } from './sdk-upgrade.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes, createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

@Injectable()
export class PreviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewService.name);
  // Track ongoing builds to prevent race conditions
  private readonly buildingProjects = new Set<string>();
  // Nonce per project so stale builds don't overwrite new state
  private readonly buildNonces = new Map<string, string>();
  // Idle reaper timer
  private idleReaperTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Idle timeout in ms. Previews not accessed within this window
   * are automatically stopped to free server resources.
   * Default: 15 minutes. Configurable via PREVIEW_IDLE_TIMEOUT_MS.
   */
  private get idleTimeoutMs(): number {
    return this.configService.get<number>(
      'PREVIEW_IDLE_TIMEOUT_MS',
      15 * 60 * 1000,
    );
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly gateway: EventsGateway,
    @Inject(RUNNER_TOKEN)
    private readonly runner: Runner,
    private readonly templatesService: TemplatesService,
  ) {}

  async onModuleInit() {
    // Reset any stale "building" previews left over from a previous crash.
    // The in-memory buildingProjects set is empty on fresh boot, so anything
    // still marked "building" in Redis is orphaned.
    await this.resetStaleBuildingPreviews();

    // Run idle reaper every 2 minutes
    this.idleReaperTimer = setInterval(
      () => {
        this.reapIdlePreviews().catch((err) =>
          this.logger.error(`Idle reaper failed: ${err.message}`),
        );
      },
      2 * 60 * 1000,
    );
    this.logger.log(
      `Idle preview reaper started (timeout: ${this.idleTimeoutMs / 1000}s)`,
    );
  }

  private async resetStaleBuildingPreviews(): Promise<void> {
    const projectIds = await this.redis.smembers('global-active-previews');
    for (const pid of projectIds) {
      const state = await this.getPreviewStatus(pid);
      if (state.status === PreviewStatus.BUILDING) {
        this.logger.warn(`Resetting stale building preview: ${pid}`);
        await this.redis.del(`preview:${pid}`);
        await this.redis.srem('global-active-previews', pid);
        await this.runner.cleanup(pid);
      }
    }
  }

  onModuleDestroy() {
    if (this.idleReaperTimer) {
      clearInterval(this.idleReaperTimer);
      this.idleReaperTimer = null;
    }
  }

  /**
   * Record that a preview was accessed (proxy request or status poll).
   * Used by the idle reaper to determine which previews are still in use.
   */
  async touchPreview(projectId: string): Promise<void> {
    await this.redis.set(
      `preview-last-access:${projectId}`,
      Date.now().toString(),
      'EX',
      3600,
    );
  }

  /**
   * Stop previews that haven't been accessed within the idle timeout.
   * Runs periodically via setInterval.
   */
  private async reapIdlePreviews(): Promise<void> {
    const projectIds = await this.redis.smembers('global-active-previews');
    if (projectIds.length === 0) return;

    const now = Date.now();
    for (const pid of projectIds) {
      const state = await this.getPreviewStatus(pid);
      if (state.status !== PreviewStatus.READY) continue; // Only reap READY previews, not BUILDING

      const lastAccess = await this.redis.get(`preview-last-access:${pid}`);
      const lastAccessTime = lastAccess ? parseInt(lastAccess, 10) : 0;

      if (now - lastAccessTime > this.idleTimeoutMs) {
        this.logger.log(
          `Reaping idle preview: ${pid} (last access: ${Math.round((now - lastAccessTime) / 1000)}s ago)`,
        );
        // Stop without userId — we don't track userId in global set
        // The per-user set cleanup happens via getActivePreviewCount validation
        await this.stopPreview(pid);
        this.gateway.emitToProject(pid, 'preview:stopped', {
          projectId: pid,
          reason: 'idle_timeout',
        });
      }
    }
  }

  private get dbPassword(): string {
    return this.configService.get<string>('DATABASE_PASSWORD', 'postgres');
  }

  private static readonly MAX_PREVIEWS_PER_USER = 3;

  /**
   * Global limit — protects the host from OOM when many users hit preview.
   * Each container uses 1-1.5 GB RAM, so on a 32 GB server ≈ 20-25 safe.
   * Configurable via PREVIEW_MAX_GLOBAL env var.
   */
  private get maxGlobalPreviews(): number {
    return this.configService.get<number>('PREVIEW_MAX_GLOBAL', 50);
  }

  /**
   * Validate the user-previews set against actual preview states in Redis.
   * Remove stale entries (projects no longer BUILDING or READY).
   */
  private async getActivePreviewCount(userId: string): Promise<number> {
    const setKey = `user-previews:${userId}`;
    const projectIds = await this.redis.smembers(setKey);
    if (projectIds.length === 0) return 0;

    let activeCount = 0;
    for (const pid of projectIds) {
      const state = await this.getPreviewStatus(pid);
      if (
        state.status === PreviewStatus.BUILDING ||
        state.status === PreviewStatus.READY
      ) {
        activeCount++;
      } else {
        await this.redis.srem(setKey, pid);
      }
    }
    return activeCount;
  }

  /**
   * Count all active previews across all users (BUILDING or READY).
   * Uses a global Redis set for O(1) membership checks.
   */
  private async getGlobalActiveCount(): Promise<number> {
    const projectIds = await this.redis.smembers('global-active-previews');
    if (projectIds.length === 0) return 0;

    let activeCount = 0;
    for (const pid of projectIds) {
      const state = await this.getPreviewStatus(pid);
      if (
        state.status === PreviewStatus.BUILDING ||
        state.status === PreviewStatus.READY
      ) {
        activeCount++;
      } else {
        await this.redis.srem('global-active-previews', pid);
      }
    }
    return activeCount;
  }

  async startPreview(
    projectId: string,
    userId?: string,
  ): Promise<PreviewState> {
    // 1. Global capacity check — prevent host OOM
    const globalCount = await this.getGlobalActiveCount();
    if (globalCount >= this.maxGlobalPreviews) {
      throw new BadRequestException(
        `Server is at capacity (${globalCount}/${this.maxGlobalPreviews} active previews). Please try again in a few minutes.`,
      );
    }

    // 2. Per-user limit
    if (userId) {
      const activeCount = await this.getActivePreviewCount(userId);
      if (activeCount >= PreviewService.MAX_PREVIEWS_PER_USER) {
        throw new BadRequestException(
          `Maximum ${PreviewService.MAX_PREVIEWS_PER_USER} concurrent previews. Stop an existing preview first.`,
        );
      }
      await this.redis.sadd(`user-previews:${userId}`, projectId);
    }

    // 3. Register in global set
    await this.redis.sadd('global-active-previews', projectId);

    // Check if already building - prevent race condition
    if (this.buildingProjects.has(projectId)) {
      this.logger.warn(
        `Build already in progress for project ${projectId}, skipping`,
      );
      const state: PreviewState = {
        projectId,
        status: PreviewStatus.BUILDING,
        startedAt: new Date(),
      };
      return state;
    }

    // Recover from ghost "building" state: Redis says building but no
    // container exists and no in-memory build is tracked.
    const currentState = await this.getPreviewStatus(projectId);
    if (currentState.status === PreviewStatus.BUILDING) {
      const exists = this.runner.containerExists
        ? await this.runner.containerExists(projectId)
        : true;
      if (!exists) {
        this.logger.warn(`Ghost building state for ${projectId}, resetting`);
        try {
          await this.runner.cleanup(projectId);
        } catch {
          /* ignore */
        }
        await this.redis.del(`preview:${projectId}`);
      }
    }

    const state: PreviewState = {
      projectId,
      status: PreviewStatus.BUILDING,
      startedAt: new Date(),
    };

    await this.redis.set(
      `preview:${projectId}`,
      JSON.stringify(state),
      'EX',
      3600,
    );

    this.gateway.emitToProject(projectId, 'preview:building', { projectId });

    this.logger.log(`Preview build started for project ${projectId}`);

    // Mark as building with a unique nonce so stale builds can be detected
    this.buildingProjects.add(projectId);
    const nonce = randomBytes(8).toString('hex');
    this.buildNonces.set(projectId, nonce);

    // Fire and forget the actual build
    this.buildAndStart(projectId)
      .catch(async (error) => {
        // If nonce changed, a newer build was started — don't overwrite its state
        if (this.buildNonces.get(projectId) !== nonce) return;

        const msg = error instanceof Error ? error.message : 'Build failed';
        this.logger.error(
          `Preview build failed for project ${projectId}: ${msg}`,
        );

        // Send error details to log stream so user can see what went wrong
        this.gateway.emitToProject(projectId, 'sandbox:log', {
          projectId,
          line: `[ERROR] Preview build failed: ${msg}`,
          timestamp: new Date().toISOString(),
        });

        try {
          await this.runner.cleanup(projectId);
        } catch {
          /* best-effort */
        }
        await this.markError(projectId, msg);
      })
      .finally(() => {
        // Only clear building flag if this is still the active build
        if (this.buildNonces.get(projectId) === nonce) {
          this.buildingProjects.delete(projectId);
        }
      });

    return state;
  }

  private emitBuildLog(projectId: string, message: string): void {
    this.gateway.emitToProject(projectId, 'sandbox:log', {
      projectId,
      line: `[build] ${message}`,
      timestamp: new Date().toISOString(),
    });
  }

  private async buildAndStart(projectId: string): Promise<void> {
    // 1. Fetch project files and project info
    this.emitBuildLog(projectId, 'Fetching project files...');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { templateId: true },
    });

    let files = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });

    // Auto-seed template files for empty projects (handles legacy projects
    // created before the template-always-seed fix).
    if (files.length === 0) {
      this.emitBuildLog(
        projectId,
        'Project is empty, seeding Expo starter files...',
      );
      const industryId = project?.templateId || 'custom';
      const template = this.templatesService.findById(industryId);
      await this.prisma.projectFile.createMany({
        data: template.files.map((file) => ({
          path: file.path,
          content: file.content,
          size: Buffer.byteLength(file.content, 'utf8'),
          projectId,
        })),
      });
      files = template.files.map((f) => ({ path: f.path, content: f.content }));
      this.emitBuildLog(projectId, `Seeded ${files.length} starter files`);
    }

    this.emitBuildLog(projectId, `Found ${files.length} files`);

    // 2. Detect framework from template or package.json
    const framework = this.detectFramework(project?.templateId ?? null, files);
    const frameworkConfig =
      FRAMEWORK_CONFIGS[framework] ?? FRAMEWORK_CONFIGS.expo;
    this.emitBuildLog(projectId, `Detected framework: ${framework}`);

    // 3. Write files to temp directory — clean first to remove stale artifacts.
    //    Docker containers create files as root, so fs.rm may fail with EACCES.
    //    Use a throwaway container to clean up with root permissions.
    this.emitBuildLog(projectId, 'Writing files to sandbox...');
    const workDir = this.getWorkDir(projectId);
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // Root-owned files from previous container — clean via Docker
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
        // Best-effort — directory will be overwritten
      }
    }
    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o700);

    for (const file of files) {
      const filePath = path.join(workDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    this.emitBuildLog(projectId, `Wrote ${files.length} files to ${workDir}`);

    // Auto-migrate older projects (SDK 52 / 53, or templates that
    // predate the SDK-54 version matrix) forward so `npm install`
    // doesn't ETARGET on versions that no longer exist on the
    // registry. No-op when the project is already on target.
    const upgraded = await upgradeProjectToTargetSdk(workDir);
    if (upgraded) {
      this.emitBuildLog(
        projectId,
        '✓ migrated package.json to target Expo SDK',
      );
    }

    // 3.0b. Inject metro.config.js pointing Metro at the shared on-disk
    // cache at /root/.metro-cache. That directory is seeded from the
    // bv-expo-preview image layer into the bv-metro-cache-v1 volume, so
    // every heavy upstream module (react-native, @react-navigation,
    // @expo/vector-icons, etc.) has a hot transform cache entry.
    // Without this, Metro uses its default per-project /tmp cache and
    // bundles the entire graph cold (~2-3 minutes).
    //
    // We only write this file when the user's project does NOT already
    // have its own metro.config.js — never clobber a user-authored one.
    const metroConfigPath = path.join(workDir, 'metro.config.js');
    const touchBridgePath = path.join(workDir, 'bv-touch-bridge.js');
    const previewEntryPath = path.join(workDir, 'bv-preview-entry.js');
    const hasUserMetroConfig = files.some((f) => f.path === 'metro.config.js');
    const hasUserPreviewEntry = files.some(
      (f) =>
        f.path === 'bv-preview-entry.js' || f.path === 'bv-touch-bridge.js',
    );
    if (!hasUserMetroConfig) {
      // ── Touch bridge: runs inside the iframe, receives postMessage from
      // the parent, synthesises PointerEvent + TouchEvent on elementFromPoint.
      // This is the receiver half of the touch simulation. The parent half
      // lives in preview-panel.tsx as a pointer-event overlay.
      //
      // We intentionally do NOT try to inject this via Metro's middleware
      // or getPolyfills hooks — Expo CLI's middleware chain runs BEFORE
      // Metro for root HTML, and its getPolyfills override silently drops
      // extra entries for web platform. The only reliable injection point
      // is the bundle's entry module: we write our own entry file,
      // require() the bridge for side-effects, then hand off to Expo's
      // registerRootComponent. The bundle then loads our entry first by
      // virtue of package.json "main" being rewritten below.
      const touchBridgeContent = `// Auto-generated by Bolder Vibes preview service.
// Loaded as a Metro module by bv-preview-entry.js — runs before the
// user's App component renders, so the iframe is ready to accept
// parent pointer events immediately.
/* eslint-disable */
if (typeof window !== 'undefined' && !window.__bvTouchBridgeInstalled) {
  window.__bvTouchBridgeInstalled = true;
  var __bvTracked = new Map();
  var __bvFire = function (target, type, x, y, id) {
    try {
      var pe = new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0,
        buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1,
        bubbles: true, cancelable: true, composed: true,
      });
      target.dispatchEvent(pe);
    } catch (_) {}
    var touchType = ({
      pointerdown: 'touchstart',
      pointermove: 'touchmove',
      pointerup: 'touchend',
      pointercancel: 'touchcancel',
    })[type];
    if (touchType && typeof Touch !== 'undefined') {
      try {
        var t = new Touch({
          identifier: id, target: target,
          clientX: x, clientY: y, screenX: x, screenY: y, pageX: x, pageY: y,
          radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
        });
        var list = (touchType === 'touchend' || touchType === 'touchcancel') ? [] : [t];
        var te = new TouchEvent(touchType, {
          touches: list, targetTouches: list, changedTouches: [t],
          bubbles: true, cancelable: true, composed: true,
        });
        target.dispatchEvent(te);
      } catch (_) {}
    }
  };
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__bvTouch !== true) return;
    var id = d.id | 0;
    if (d.type === 'down') {
      var target = document.elementFromPoint(d.x, d.y) || document.body;
      __bvTracked.set(id, { target: target, startX: d.x, startY: d.y, startT: Date.now() });
      __bvFire(target, 'pointerdown', d.x, d.y, id);
    } else if (d.type === 'move') {
      var em = __bvTracked.get(id);
      if (!em) return;
      __bvFire(em.target, 'pointermove', d.x, d.y, id);
    } else if (d.type === 'up') {
      var eu = __bvTracked.get(id);
      if (!eu) return;
      __bvFire(eu.target, 'pointerup', d.x, d.y, id);
      var dx = d.x - eu.startX, dy = d.y - eu.startY;
      if (dx * dx + dy * dy < 64 && Date.now() - eu.startT < 500) {
        var ct = document.elementFromPoint(d.x, d.y) || eu.target;
        try {
          ct.dispatchEvent(new MouseEvent('click', {
            clientX: d.x, clientY: d.y, bubbles: true, cancelable: true, composed: true,
          }));
        } catch (_) {}
      }
      __bvTracked.delete(id);
    } else if (d.type === 'cancel') {
      var ec = __bvTracked.get(id);
      if (!ec) return;
      __bvFire(ec.target, 'pointercancel', d.x, d.y, id);
      __bvTracked.delete(id);
    }
  });
  // Announce readiness so the parent knows the receiver is live.
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __bvTouchReady: true }, '*');
    }
  } catch (_) {}
}
module.exports = {};
`;

      // Entry wrapper that runs the touch bridge for side-effects, then
      // hands off to Expo's standard AppEntry flow. Metro will bundle
      // this file as the entry module because we rewrite package.json
      // "main" to point at it a few lines below.
      const previewEntryContent = `// Auto-generated by Bolder Vibes preview service.
// This file is the bundle entry point (see package.json "main"). It
// installs the touch bridge first, then re-exports Expo's standard
// AppEntry which in turn registers the root component from App.tsx.
/* eslint-disable */
require('./bv-touch-bridge');
require('expo/AppEntry');
`;

      const metroConfigContent = `// Auto-injected by Bolder Vibes preview service.
// Points Metro at the shared cache directory seeded from the
// bv-expo-preview base image so warm transforms hit immediately.
const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);
config.cacheStores = [
  new FileStore({ root: '/root/.metro-cache' }),
];

module.exports = config;
`;

      if (!hasUserPreviewEntry) {
        await fs.writeFile(touchBridgePath, touchBridgeContent);
        await fs.writeFile(previewEntryPath, previewEntryContent);
      }
      await fs.writeFile(metroConfigPath, metroConfigContent);
      this.emitBuildLog(
        projectId,
        '✓ injected metro.config.js + touch bridge entry',
      );
    }

    // 3.1. Ensure package.json exists before starting the container — if it
    // is missing, npm install will fail and the container will crash.
    const packageJsonPath = path.join(workDir, 'package.json');
    try {
      await fs.access(packageJsonPath);
      this.emitBuildLog(projectId, '✓ package.json verified');
    } catch {
      throw new Error(
        'Project is missing package.json — cannot start preview. Ensure an industry template was applied when creating the project.',
      );
    }

    // 3.2. Ensure @expo/metro-runtime is in dependencies (required for
    // Expo Web). Legacy projects created before this dep was added to the
    // template need it injected here.
    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      const deps = pkg.dependencies ?? {};
      let pkgDirty = false;
      if (!deps['@expo/metro-runtime']) {
        deps['@expo/metro-runtime'] = '~4.0.1';
        pkg.dependencies = deps;
        pkgDirty = true;
        this.emitBuildLog(projectId, '✓ injected @expo/metro-runtime');
      }
      // Point the bundle entry at our wrapper that installs the touch
      // bridge before handing off to Expo's standard AppEntry flow.
      // Only rewrite if the user is still on the default entry — never
      // clobber a custom `main` (e.g. expo-router/entry).
      if (
        !hasUserPreviewEntry &&
        (!pkg.main ||
          pkg.main === 'expo/AppEntry.js' ||
          pkg.main === 'expo/AppEntry' ||
          pkg.main === 'node_modules/expo/AppEntry.js')
      ) {
        pkg.main = 'bv-preview-entry.js';
        pkgDirty = true;
        this.emitBuildLog(
          projectId,
          '✓ rewrote package.json main → bv-preview-entry.js',
        );
      }
      if (pkgDirty) {
        await fs.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2));
      }
    } catch {
      // Non-fatal — npm install may still work
    }

    // 3.2b. For fullstack/backend frameworks, write the same-origin reverse
    //       proxy script. See PROXY_SCRIPT in preview.interface.ts.
    //       The proxy listens on container port 3000 (exposed) and fans
    //       requests to Metro on :3100 or backend on :3001 inside the
    //       same container, so browsers hit everything same-origin.
    if (framework === 'expo-fullstack' || framework === 'expo-backend') {
      const proxyPath = path.join(workDir, 'bv-proxy.js');
      await fs.writeFile(proxyPath, PROXY_SCRIPT);
      this.emitBuildLog(
        projectId,
        '✓ injected bv-proxy.js (same-origin gateway)',
      );
    }

    // 3.3. Ensure Prisma dependencies exist when schema.prisma is present
    await this.ensurePrismaDeps(workDir, projectId);

    // 3.4. Ensure Prisma config matches the installed version
    await this.ensurePrismaConfig(workDir, projectId);

    // 4. Start database if needed (Prisma projects)
    if (!this.runner.startLongRunning) {
      throw new Error('Runner does not support long-running containers');
    }

    const isFullstack =
      framework === 'expo-backend' || framework === 'expo-fullstack';
    // Start database for fullstack apps with Prisma or when the AI may generate DB code.
    const needsDatabase = framework === 'expo-fullstack' || isFullstack;
    const suffix = projectId.replace(/-/g, '');
    const networkName = `bv-net-${suffix}`;
    const dbContainerName = `bv-db-${suffix}`;
    const password = this.dbPassword;

    let envVars: Record<string, string> = {};
    let dockerNetwork: string | undefined;

    if (needsDatabase) {
      if (!this.runner.createNetwork || !this.runner.startDatabase) {
        throw new Error('Runner does not support database containers');
      }

      await this.runner.createNetwork(networkName);
      await this.runner.startDatabase(projectId, networkName, password);
      await this.waitForDatabase(dbContainerName);

      const databaseUrl = `postgresql://postgres:${password}@${dbContainerName}:5432/app`;
      envVars.DATABASE_URL = databaseUrl;
      dockerNetwork = networkName;
    }

    // For fullstack apps, provide a discovery env var so AI-generated
    // code knows what port the backend is on.
    // IMPORTANT: do NOT set PORT or HOST as container-wide env vars —
    // they would leak into the Expo process and override its --port 3000
    // / 0.0.0.0 binding, breaking port mapping. The server subprocess
    // sets its own PORT/HOST inline in the dev command.
    if (isFullstack) {
      envVars.BACKEND_PORT = '3001';
    }

    // 5. Build install command — append Prisma setup dynamically if schema exists
    let installCommand = frameworkConfig.installCommand;
    const hasPrismaSchema = files.some(
      (f) =>
        f.path === 'server/prisma/schema.prisma' ||
        f.path === 'prisma/schema.prisma' ||
        f.path === 'backend/prisma/schema.prisma',
    );
    if (hasPrismaSchema) {
      // Detect which directory contains the schema to cd into
      const prismaDir = files.some(
        (f) => f.path === 'server/prisma/schema.prisma',
      )
        ? 'server'
        : files.some((f) => f.path === 'backend/prisma/schema.prisma')
          ? 'backend'
          : '.';
      // Install OpenSSL — Prisma's schema engine (native binary) needs libssl
      // to run on Alpine. Without it, db push fails with "Error loading..."
      const prismaSetup = `apk add --no-cache openssl && cd /app/${prismaDir} && npx prisma generate && npx prisma db push --accept-data-loss`;
      installCommand = `${installCommand} && (${prismaSetup})`;
    }

    // 6. Compute a SHA of the user's package.json so the runner can decide
    //    whether an existing container is still reusable. Missing file →
    //    empty label, which still matches the baked image's no-op install.
    const pkgJsonFile = files.find((f) => f.path === 'package.json');
    const pkgSha = pkgJsonFile
      ? createHash('sha256').update(pkgJsonFile.content).digest('hex')
      : '';

    // 7. Start app container
    this.emitBuildLog(projectId, 'Starting Docker container...');
    const fullCommand = `(${installCommand}) && (${frameworkConfig.devCommand})`;
    // Metro's parallel transform workers can easily allocate 1.5-2 GB
    // when bundling large React Native projects (600+ modules, multiple
    // @react-navigation packages, vector icons). Too-tight memory caps
    // cause expo start to be SIGKILLed mid-bundle before Metro ever
    // writes "Web Bundled Xms" and the container exits with code 1.
    const memoryMb = isFullstack ? 2560 : 2048;
    // Increase timeout for npm install + dev server startup
    const containerTimeoutMs = isFullstack || needsDatabase ? 600000 : 300000; // 10min or 5min
    const { port, reused } = await this.runner.startLongRunning(
      projectId,
      workDir,
      fullCommand,
      {
        networkEnabled: true,
        timeoutMs: containerTimeoutMs,
        maxMemoryMb: memoryMb,
        envVars,
        dockerNetwork,
        image: frameworkConfig.image,
        labels: pkgSha ? { bv_pkg_sha: pkgSha } : undefined,
      },
      frameworkConfig.containerPort,
    );

    if (reused) {
      this.emitBuildLog(
        projectId,
        `Reusing running container on port ${port} (pkg sha match) — skipping bundle`,
      );
    } else {
      this.emitBuildLog(
        projectId,
        `Container started on port ${port}, running: ${fullCommand}`,
      );
    }

    // 6. Start log streaming IMMEDIATELY and watch for bundle errors.
    // Metro/Expo prints "Web Bundling failed" when an import is missing
    // or there's a syntax error. We capture the next few lines (the actual
    // error message) and surface them as the preview's error state.
    let bundleError: string | null = null;
    let bundleErrorBuffer: string[] = [];
    let captureLines = 0;
    if (this.runner.streamLogs) {
      this.runner.streamLogs(projectId, (line) => {
        this.gateway.emitToProject(projectId, 'sandbox:log', {
          projectId,
          line,
          timestamp: new Date().toISOString(),
        });

        // Detect Metro bundle failures
        if (/Web Bundling failed/i.test(line) || /Metro error/i.test(line)) {
          captureLines = 5; // capture next 5 lines for the error detail
          bundleErrorBuffer = [line];
        } else if (captureLines > 0) {
          bundleErrorBuffer.push(line);
          captureLines--;
          if (captureLines === 0) {
            bundleError = bundleErrorBuffer.join('\n');
          }
        }
      });
    }

    // 7. Wait for dev server to become ready
    this.emitBuildLog(projectId, 'Waiting for dev server to start...');
    const readyTimeoutMs = isFullstack || needsDatabase ? 240000 : 180000;
    try {
      await this.waitForReady(port, readyTimeoutMs);
    } catch (error) {
      // Grab container logs for the error message so the user can debug
      let logs = '';
      if (this.runner.getContainerLogs) {
        try {
          logs = await this.runner.getContainerLogs(projectId);
        } catch {
          /* ignore */
        }
      }
      const baseMsg = error instanceof Error ? error.message : 'Build failed';
      const detail = logs
        ? `${baseMsg}\n\nLast logs:\n${logs.slice(-1000)}`
        : baseMsg;
      throw new Error(detail);
    }

    // 8. Mark ready immediately — the HTTP server is up. Bundle errors
    //    surface in the background watcher below; the user sees the iframe
    //    fast and gets a clear error toast if Metro fails to bundle.
    const rawUrl = `http://localhost:${port}`;
    await this.markReady(projectId, rawUrl);

    // 8.1. Background watcher — if bundling fails after we marked ready,
    //      flip the preview to error state so the frontend can react.
    void (async () => {
      const start = Date.now();
      const maxWatchMs = 5 * 60 * 1000; // 5 minutes
      while (Date.now() - start < maxWatchMs) {
        if (bundleError) {
          await this.markError(projectId, `Bundle error:\n${bundleError}`);
          return;
        }
        if (this.runner.containerExists) {
          const exists = await this.runner.containerExists(projectId);
          if (!exists) {
            await this.markError(
              projectId,
              'Preview container exited unexpectedly — check the Logs tab for details.',
            );
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
  }

  /**
   * Sync a single file to the running preview container's working directory.
   * Since the workDir is volume-mounted, Vite HMR / Next.js Fast Refresh
   * will automatically pick up the change.
   *
   * When package.json or prisma/schema.prisma changes, automatically runs
   * npm install or prisma generate inside the container.
   */
  async syncFile(
    projectId: string,
    filePath: string,
    content: string | null,
  ): Promise<void> {
    // Source-of-truth check: does the workDir actually exist on disk?
    // Redis state alone is unreliable — keys expire on TTL while the
    // Docker container keeps running, and transient ERROR states
    // shouldn't block file writes. If the directory exists, Metro's
    // bind-mounted /app points at it, so the write is meaningful.
    const state = await this.getPreviewStatus(projectId);
    const workDir = this.getWorkDir(projectId);
    const dirExists = await fs
      .stat(workDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!dirExists) {
      this.logger.debug(
        `Skip web sync for ${projectId}: workDir missing (state=${state.status})`,
      );
      return;
    }

    const fullPath = path.join(workDir, filePath);

    if (content === null) {
      // File deleted
      try {
        await fs.unlink(fullPath);
      } catch {
        // File may not exist on disk
      }
    } else {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    this.logger.debug(`Synced file to preview: ${filePath}`);

    // Auto-run commands when special files change — only when the
    // container is live enough for `docker exec` to land.
    if (
      this.runner.execInContainer &&
      content !== null &&
      state.status === PreviewStatus.READY
    ) {
      const postSyncCommand = this.getPostSyncCommand(filePath);
      if (postSyncCommand) {
        this.logger.log(
          `Running post-sync command for ${filePath}: ${postSyncCommand}`,
        );
        this.runner
          .execInContainer(projectId, postSyncCommand, 120000)
          .catch((err) =>
            this.logger.warn(`Post-sync command failed for ${filePath}`, err),
          );
      }
    }
  }

  /**
   * If a prisma/schema.prisma exists but the corresponding package.json
   * is missing prisma / @prisma/client, inject them so npm install
   * actually downloads Prisma before we run generate / db push.
   */
  private async ensurePrismaDeps(
    workDir: string,
    projectId: string,
  ): Promise<void> {
    const pairs = [
      { schema: 'server/prisma/schema.prisma', pkg: 'server/package.json' },
      { schema: 'prisma/schema.prisma', pkg: 'package.json' },
      { schema: 'backend/prisma/schema.prisma', pkg: 'backend/package.json' },
    ];

    for (const { schema, pkg } of pairs) {
      const schemaPath = path.join(workDir, schema);
      const pkgPath = path.join(workDir, pkg);
      try {
        await fs.access(schemaPath);
      } catch {
        continue;
      }

      try {
        const raw = await fs.readFile(pkgPath, 'utf8');
        const pkgJson = JSON.parse(raw);
        const deps = pkgJson.dependencies ?? {};
        const devDeps = pkgJson.devDependencies ?? {};
        let changed = false;

        if (!deps['@prisma/client']) {
          deps['@prisma/client'] = '^5.22.0';
          changed = true;
        }
        if (!deps['prisma'] && !devDeps['prisma']) {
          pkgJson.devDependencies = { ...devDeps, prisma: '^5.22.0' };
          changed = true;
        }

        if (changed) {
          pkgJson.dependencies = deps;
          await fs.writeFile(pkgPath, JSON.stringify(pkgJson, null, 2));
          this.emitBuildLog(projectId, '✓ injected prisma dependencies');
        }
      } catch {
        // Non-fatal — package.json may not exist or be invalid
      }
    }
  }

  /**
   * Ensure Prisma config is compatible with the installed Prisma version.
   *
   * - Prisma ≤6: url must be in the datasource block of schema.prisma.
   *   Ensure url = env("DATABASE_URL") is present.
   * - Prisma 7+: url must be in prisma.config.ts, NOT in schema.prisma.
   *   Strip url from schema and create prisma.config.ts.
   */
  private async ensurePrismaConfig(
    workDir: string,
    projectId: string,
  ): Promise<void> {
    const schemaPaths = [
      { schema: 'server/prisma/schema.prisma', pkg: 'server/package.json' },
      { schema: 'prisma/schema.prisma', pkg: 'package.json' },
      { schema: 'backend/prisma/schema.prisma', pkg: 'backend/package.json' },
    ];

    for (const { schema: rel, pkg: pkgRel } of schemaPaths) {
      const schemaFile = path.join(workDir, rel);
      let schemaContent: string;
      try {
        schemaContent = await fs.readFile(schemaFile, 'utf8');
      } catch {
        continue; // File doesn't exist
      }

      // Detect Prisma major version from package.json
      const prismaVersion = await this.detectPrismaMajor(
        path.join(workDir, pkgRel),
      );
      const serverDir = path.dirname(path.dirname(schemaFile));

      if (prismaVersion >= 7) {
        // Prisma 7+: strip url from schema, create prisma.config.ts
        if (/url\s*=\s*env\(/.test(schemaContent)) {
          const patched = schemaContent.replace(
            /^\s*url\s*=\s*env\(["']DATABASE_URL["']\)\s*$/m,
            '',
          );
          await fs.writeFile(schemaFile, patched);
        }

        const configPath = path.join(serverDir, 'prisma.config.ts');
        try {
          await fs.access(configPath);
        } catch {
          await fs.writeFile(
            configPath,
            `import { defineConfig } from "prisma/config";\n\nexport default defineConfig({\n  schema: "prisma/schema.prisma",\n  datasource: {\n    url: process.env["DATABASE_URL"],\n  },\n});\n`,
          );
        }
        this.emitBuildLog(projectId, `✓ Prisma 7 config ensured for ${rel}`);
      } else {
        // Prisma ≤6: url must be in the datasource block
        if (!/url\s*=\s*env\(/.test(schemaContent)) {
          const patched = schemaContent.replace(
            /(provider\s*=\s*"postgresql")/,
            '$1\n  url      = env("DATABASE_URL")',
          );
          await fs.writeFile(schemaFile, patched);
          this.emitBuildLog(projectId, `✓ injected DATABASE_URL into ${rel}`);
        }

        // Remove stale prisma.config.ts — Prisma ≤6 doesn't use it and
        // will crash if it finds one that imports "prisma/config".
        const staleConfig = path.join(serverDir, 'prisma.config.ts');
        try {
          await fs.unlink(staleConfig);
          this.emitBuildLog(projectId, `✓ removed stale prisma.config.ts`);
        } catch {
          // File doesn't exist — nothing to clean
        }
      }
    }
  }

  /**
   * Read the prisma version from a package.json and return the major number.
   * Returns 5 as fallback if detection fails.
   */
  private async detectPrismaMajor(packageJsonPath: string): Promise<number> {
    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      const version =
        pkg.dependencies?.prisma ??
        pkg.devDependencies?.prisma ??
        pkg.dependencies?.['@prisma/client'] ??
        pkg.devDependencies?.['@prisma/client'] ??
        '';
      const match = version.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 5;
    } catch {
      return 5;
    }
  }

  private getPostSyncCommand(filePath: string): string | null {
    // package.json changes → npm install in the correct directory
    if (filePath === 'package.json') return 'cd /app && npm install';
    if (filePath === 'client/package.json')
      return 'cd /app/client && npm install';
    if (filePath === 'server/package.json')
      return 'cd /app/server && npm install';
    if (filePath === 'frontend/package.json')
      return 'cd /app/frontend && npm install';
    if (filePath === 'backend/package.json')
      return 'cd /app/backend && npm install';

    // Prisma schema changes → regenerate client and push schema
    if (filePath === 'prisma/schema.prisma')
      return 'cd /app && npx prisma generate && npx prisma db push --accept-data-loss';
    if (filePath === 'server/prisma/schema.prisma')
      return 'cd /app/server && npx prisma generate && npx prisma db push --accept-data-loss';
    if (filePath === 'backend/prisma/schema.prisma')
      return 'cd /app/backend && npx prisma generate && npx prisma db push --accept-data-loss';

    return null;
  }

  private getWorkDir(projectId: string): string {
    return path.join(os.tmpdir(), `bv-preview-${projectId.replace(/-/g, '')}`);
  }

  private detectFramework(
    templateId: string | null,
    files: { path: string; content: string }[],
  ): string {
    // 1. All industry templates use Expo
    const industryIds = [
      'ecommerce',
      'social',
      'health',
      'education',
      'food',
      'productivity',
      'finance',
      'custom',
    ];
    const hasServerDir = files.some((f) => f.path.startsWith('server/'));
    const hasPrismaSchema = files.some(
      (f) =>
        f.path === 'server/prisma/schema.prisma' ||
        f.path === 'prisma/schema.prisma',
    );

    if (templateId && industryIds.includes(templateId)) {
      if (hasServerDir && hasPrismaSchema) return 'expo-fullstack';
      if (hasServerDir) return 'expo-backend';
      return 'expo';
    }

    // 2. Detect from project structure
    if (hasServerDir && hasPrismaSchema) return 'expo-fullstack';
    if (hasServerDir) return 'expo-backend';

    // 3. Detect from package.json dependencies
    const pkgFile = files.find((f) => f.path === 'package.json');
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.expo || allDeps['react-native']) return 'expo';
      } catch {
        // Invalid package.json
      }
    }

    return 'expo';
  }

  private async waitForDatabase(
    containerName: string,
    timeoutMs = 30000,
  ): Promise<void> {
    const start = Date.now();
    const pollInterval = 1000;

    while (Date.now() - start < timeoutMs) {
      try {
        const { stdout } = await execFileAsync(
          'docker',
          ['exec', containerName, 'pg_isready', '-U', 'postgres'],
          { timeout: 5000 },
        );
        if (stdout.includes('accepting connections')) {
          this.logger.log(`Database ready: ${containerName}`);
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Database did not become ready within ${timeoutMs}ms`);
  }

  private async waitForReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 500; // Poll every 500ms for fast detection

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`http://localhost:${port}`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok || response.status < 500) {
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Preview server did not become ready within ${timeoutMs}ms`,
    );
  }

  async getPreviewStatus(projectId: string): Promise<PreviewState> {
    const data = await this.redis.get(`preview:${projectId}`);
    if (!data) {
      return {
        projectId,
        status: PreviewStatus.IDLE,
      };
    }
    return JSON.parse(data) as PreviewState;
  }

  async stopPreview(projectId: string, userId?: string): Promise<void> {
    // Invalidate any in-progress build so its handlers become no-ops
    this.buildingProjects.delete(projectId);
    this.buildNonces.delete(projectId);

    // Remove from tracking sets
    if (userId) {
      await this.redis.srem(`user-previews:${userId}`, projectId);
    }
    await this.redis.srem('global-active-previews', projectId);

    await this.redis.del(`preview:${projectId}`);

    // Stop and remove the Docker container
    await this.runner.cleanup(projectId);

    // Cleanup temp directory — Docker creates root-owned files, so use a
    // throwaway container if fs.rm fails with permission errors.
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
        // Best-effort
      }
    }

    this.logger.log(`Preview stopped for project ${projectId}`);
  }

  async markReady(projectId: string, url: string): Promise<void> {
    const state: PreviewState = {
      projectId,
      status: PreviewStatus.READY,
      url,
    };
    await this.redis.set(
      `preview:${projectId}`,
      JSON.stringify(state),
      'EX',
      3600,
    );
    // Set initial access time for idle reaper
    await this.touchPreview(projectId);
    this.gateway.emitToProject(projectId, 'preview:ready', { projectId, url });
    this.logger.log(`Preview ready for project ${projectId}: ${url}`);
  }

  /**
   * Create a short-lived preview token (5 min TTL) for iframe authentication.
   * This avoids exposing the full JWT as a query parameter.
   */
  async createPreviewToken(projectId: string, userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(
      `preview-token:${token}`,
      JSON.stringify({ projectId, userId }),
      'EX',
      300, // 5 minutes
    );
    return token;
  }

  /**
   * Validate a preview token and return the associated projectId/userId.
   * Token is single-use: it is NOT deleted after validation to allow
   * multiple resource loads (CSS, JS, images) within the TTL window.
   */
  async validatePreviewToken(
    token: string,
  ): Promise<{ projectId: string; userId: string } | null> {
    const data = await this.redis.get(`preview-token:${token}`);
    if (!data) return null;
    return JSON.parse(data) as { projectId: string; userId: string };
  }

  async markError(projectId: string, error: string): Promise<void> {
    const state: PreviewState = {
      projectId,
      status: PreviewStatus.ERROR,
      error,
    };
    await this.redis.set(
      `preview:${projectId}`,
      JSON.stringify(state),
      'EX',
      3600,
    );
    this.gateway.emitToProject(projectId, 'preview:error', {
      projectId,
      error,
    });
  }
}
