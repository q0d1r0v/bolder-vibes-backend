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
import {
  PreviewStatus,
  PreviewState,
  FRAMEWORK_CONFIGS,
} from './preview.interface.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

@Injectable()
export class PreviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PreviewService.name);
  // Track ongoing builds to prevent race conditions
  private readonly buildingProjects = new Set<string>();
  // Idle reaper timer
  private idleReaperTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Idle timeout in ms. Previews not accessed within this window
   * are automatically stopped to free server resources.
   * Default: 15 minutes. Configurable via PREVIEW_IDLE_TIMEOUT_MS.
   */
  private get idleTimeoutMs(): number {
    return this.configService.get<number>('PREVIEW_IDLE_TIMEOUT_MS', 15 * 60 * 1000);
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => EventsGateway))
    private readonly gateway: EventsGateway,
    @Inject(RUNNER_TOKEN)
    private readonly runner: Runner,
  ) {}

  onModuleInit() {
    // Run idle reaper every 2 minutes
    this.idleReaperTimer = setInterval(() => {
      this.reapIdlePreviews().catch((err) =>
        this.logger.error(`Idle reaper failed: ${err.message}`),
      );
    }, 2 * 60 * 1000);
    this.logger.log(`Idle preview reaper started (timeout: ${this.idleTimeoutMs / 1000}s)`);
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
    await this.redis.set(`preview-last-access:${projectId}`, Date.now().toString(), 'EX', 3600);
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
        this.logger.log(`Reaping idle preview: ${pid} (last access: ${Math.round((now - lastAccessTime) / 1000)}s ago)`);
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
      if (state.status === PreviewStatus.BUILDING || state.status === PreviewStatus.READY) {
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
      if (state.status === PreviewStatus.BUILDING || state.status === PreviewStatus.READY) {
        activeCount++;
      } else {
        await this.redis.srem('global-active-previews', pid);
      }
    }
    return activeCount;
  }

  async startPreview(projectId: string, userId?: string): Promise<PreviewState> {
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
      this.logger.warn(`Build already in progress for project ${projectId}, skipping`);
      const state: PreviewState = {
        projectId,
        status: PreviewStatus.BUILDING,
        startedAt: new Date(),
      };
      return state;
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

    // Mark as building
    this.buildingProjects.add(projectId);

    // Fire and forget the actual build
    this.buildAndStart(projectId)
      .catch(async (error) => {
        const msg = error instanceof Error ? error.message : 'Build failed';
        this.logger.error(`Preview build failed for project ${projectId}: ${msg}`);

        // Send error details to log stream so user can see what went wrong
        this.gateway.emitToProject(projectId, 'sandbox:log', {
          projectId,
          line: `[ERROR] Preview build failed: ${msg}`,
          timestamp: new Date().toISOString(),
        });

        await this.markError(projectId, msg);
      })
      .finally(() => {
        // Remove from building set when done (success or failure)
        this.buildingProjects.delete(projectId);
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

    const [files, project] = await Promise.all([
      this.prisma.projectFile.findMany({
        where: { projectId },
        select: { path: true, content: true },
      }),
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { templateId: true },
      }),
    ]);

    if (files.length === 0) {
      throw new Error('No files in project to preview');
    }

    this.emitBuildLog(projectId, `Found ${files.length} files`);

    // 2. Detect framework from template or package.json
    const framework = this.detectFramework(
      project?.templateId ?? null,
      files,
    );
    const frameworkConfig = FRAMEWORK_CONFIGS[framework] ?? FRAMEWORK_CONFIGS.default;
    this.emitBuildLog(projectId, `Detected framework: ${framework}`);

    // 3. Write files to temp directory
    this.emitBuildLog(projectId, 'Writing files to sandbox...');
    const workDir = this.getWorkDir(projectId);
    await fs.mkdir(workDir, { recursive: true });
    await fs.chmod(workDir, 0o700);

    for (const file of files) {
      const filePath = path.join(workDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    this.emitBuildLog(projectId, `Wrote ${files.length} files to ${workDir}`);

    // 3.1. Ensure package.json exists - if not, create a minimal one
    const packageJsonPath = path.join(workDir, 'package.json');
    const hasPackageJson = files.some((f) => f.path === 'package.json');
    
    if (!hasPackageJson) {
      this.emitBuildLog(projectId, 'Creating minimal package.json...');
      const minimalPkg = {
        name: `preview-${projectId}`,
        version: '1.0.0',
        private: true,
      };
      await fs.writeFile(packageJsonPath, JSON.stringify(minimalPkg, null, 2));
    }

    // 4. Start database if needed (Prisma projects)
    if (!this.runner.startLongRunning) {
      throw new Error('Runner does not support long-running containers');
    }

    const isFullstack =
      framework === 'react-express' || framework === 'react-express-prisma' ||
      framework === 'react-express-fb' || framework === 'react-express-prisma-fb';
    // Start database for ALL fullstack apps — the AI may generate DB code
    // even when Prisma wasn't in the original template.
    const needsDatabase = framework.includes('prisma') || isFullstack;
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

    // For fullstack apps, provide standard env vars so backend and frontend
    // can discover each other inside the container.
    if (isFullstack) {
      envVars.PORT = '3001';
      envVars.BACKEND_PORT = '3001';
      envVars.HOST = '0.0.0.0';
    }

    // 5. Start app container
    this.emitBuildLog(projectId, 'Starting Docker container...');
    // Wrap each part in a subshell so `&` inside devCommand doesn't
    // break install sequencing (shell operator precedence bug).
    const fullCommand = `(${frameworkConfig.installCommand}) && (${frameworkConfig.devCommand})`;
    const memoryMb = isFullstack ? 1536 : 1024;
    // Increase timeout for npm install + dev server startup
    const containerTimeoutMs = isFullstack || needsDatabase ? 600000 : 300000; // 10min or 5min
    const { port } = await this.runner.startLongRunning(
      projectId,
      workDir,
      fullCommand,
      {
        networkEnabled: true,
        timeoutMs: containerTimeoutMs,
        maxMemoryMb: memoryMb,
        envVars,
        dockerNetwork,
      },
      frameworkConfig.containerPort,
    );

    this.emitBuildLog(projectId, `Container started on port ${port}, running: ${fullCommand}`);
    
    // Verify that package.json exists in the workDir (which will be mounted to /app)
    try {
      await fs.access(packageJsonPath);
      this.emitBuildLog(projectId, '✓ package.json verified');
    } catch {
      this.emitBuildLog(projectId, '⚠ WARNING: package.json not found in workDir');
    }

    // 6. Start log streaming IMMEDIATELY so the frontend sees build/install output
    if (this.runner.streamLogs) {
      this.runner.streamLogs(projectId, (line) => {
        this.gateway.emitToProject(projectId, 'sandbox:log', {
          projectId,
          line,
          timestamp: new Date().toISOString(),
        });
      });
    }

    // 7. Wait for dev server to become ready
    this.emitBuildLog(projectId, 'Waiting for dev server to start...');
    const readyTimeoutMs = isFullstack || needsDatabase ? 180000 : 120000;
    try {
      await this.waitForReady(port, readyTimeoutMs);
    } catch (error) {
      // Grab container logs for the error message so the user can debug
      let logs = '';
      if (this.runner.getContainerLogs) {
        try {
          logs = await this.runner.getContainerLogs(projectId);
        } catch { /* ignore */ }
      }
      const baseMsg = error instanceof Error ? error.message : 'Build failed';
      const detail = logs
        ? `${baseMsg}\n\nLast logs:\n${logs.slice(-1000)}`
        : baseMsg;
      throw new Error(detail);
    }

    // 8. Mark ready — store the raw container URL for the proxy controller,
    //    but tell the frontend to use the API-relative proxy path so the
    //    iframe stays on the same origin (no CORS / mixed-content issues).
    const rawUrl = `http://localhost:${port}`;
    await this.markReady(projectId, rawUrl);
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
    const state = await this.getPreviewStatus(projectId);
    if (state.status !== PreviewStatus.READY) {
      return; // No running preview to sync to
    }

    const workDir = this.getWorkDir(projectId);
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

    // Auto-run commands when special files change
    if (this.runner.execInContainer && content !== null) {
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
      return 'cd /app && npx prisma generate && npx prisma db push';
    if (filePath === 'server/prisma/schema.prisma')
      return 'cd /app/server && npx prisma generate && npx prisma db push';
    if (filePath === 'backend/prisma/schema.prisma')
      return 'cd /app/backend && npx prisma generate && npx prisma db push';

    return null;
  }

  private getWorkDir(projectId: string): string {
    return path.join(os.tmpdir(), `bv-preview-${projectId.replace(/-/g, '')}`);
  }

  private detectFramework(
    templateId: string | null,
    files: { path: string; content: string }[],
  ): string {
    // 1. Check template ID directly
    if (templateId === 'nextjs') return 'nextjs';
    if (templateId === 'react-vite') return 'react';
    if (templateId === 'express-api') return 'express';
    if (templateId === 'express-prisma') return 'express-prisma';
    if (templateId === 'react-express') return 'react-express';
    if (templateId === 'react-express-prisma') return 'react-express-prisma';

    // 2. Detect from project structure (full-stack monorepo)
    const hasClientDir = files.some((f) => f.path.startsWith('client/'));
    const hasServerDir = files.some((f) => f.path.startsWith('server/'));
    const hasFrontendDir = files.some((f) => f.path.startsWith('frontend/'));
    const hasBackendDir = files.some((f) => f.path.startsWith('backend/'));
    const hasPrismaSchema = files.some(
      (f) =>
        f.path === 'prisma/schema.prisma' ||
        f.path === 'server/prisma/schema.prisma' ||
        f.path === 'backend/prisma/schema.prisma',
    );

    // frontend/ + backend/ layout
    if (hasFrontendDir && hasBackendDir) {
      return hasPrismaSchema ? 'react-express-prisma-fb' : 'react-express-fb';
    }

    // frontend/ only (no backend)
    if (hasFrontendDir) {
      const frontendPkg = files.find((f) => f.path === 'frontend/package.json');
      if (frontendPkg) {
        try {
          const pkg = JSON.parse(frontendPkg.content);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.next) return 'nextjs-sub:frontend';
          if (deps.react || deps.vite) return 'react-sub:frontend';
        } catch { /* ignore */ }
      }
    }

    // client/ + server/ layout
    if (hasClientDir && hasServerDir) {
      return hasPrismaSchema ? 'react-express-prisma' : 'react-express';
    }

    // 3. Detect from package.json dependencies
    const pkgFile = files.find((f) => f.path === 'package.json');
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };
        if (allDeps.next) return 'nextjs';
        if (allDeps.react) return 'react';
        if (allDeps['@prisma/client'] && allDeps.express)
          return 'express-prisma';
        if (allDeps.express) return 'express';
      } catch {
        // Invalid package.json
      }
    }

    return 'default';
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

    throw new Error(
      `Database did not become ready within ${timeoutMs}ms`,
    );
  }

  private async waitForReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 2000;

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(`http://localhost:${port}`, {
          signal: AbortSignal.timeout(2000),
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
    // Remove from tracking sets
    if (userId) {
      await this.redis.srem(`user-previews:${userId}`, projectId);
    }
    await this.redis.srem('global-active-previews', projectId);

    await this.redis.del(`preview:${projectId}`);

    // Stop and remove the Docker container
    await this.runner.cleanup(projectId);

    // Cleanup temp directory
    try {
      await fs.rm(this.getWorkDir(projectId), { recursive: true, force: true });
    } catch {
      // Directory may not exist
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
