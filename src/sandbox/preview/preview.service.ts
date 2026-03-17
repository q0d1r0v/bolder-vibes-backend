import { Injectable, Inject, Logger } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { EventsGateway } from '@/gateway/events.gateway.js';
import { RUNNER_TOKEN } from '../runners/runner.interface.js';
import type { Runner } from '../runners/runner.interface.js';
import { PreviewStatus, PreviewState } from './preview.interface.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly gateway: EventsGateway,
    @Inject(RUNNER_TOKEN)
    private readonly runner: Runner,
  ) {}

  async startPreview(projectId: string): Promise<PreviewState> {
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

    // Fire and forget the actual build
    this.buildAndStart(projectId).catch(async (error) => {
      this.logger.error(`Preview build failed for project ${projectId}`, error);
      await this.markError(
        projectId,
        error instanceof Error ? error.message : 'Build failed',
      );
    });

    return state;
  }

  private async buildAndStart(projectId: string): Promise<void> {
    // 1. Fetch project files
    const files = await this.prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });

    if (files.length === 0) {
      throw new Error('No files in project to preview');
    }

    // 2. Write files to temp directory
    const workDir = path.join(
      os.tmpdir(),
      `bv-preview-${projectId.slice(0, 8)}`,
    );
    await fs.mkdir(workDir, { recursive: true });

    for (const file of files) {
      const filePath = path.join(workDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }

    // 3. Start container
    if (!this.runner.startLongRunning) {
      throw new Error('Runner does not support long-running containers');
    }

    const { port } = await this.runner.startLongRunning(
      projectId,
      workDir,
      'npm install && npm run dev -- --host 0.0.0.0 --port 3000',
      { networkEnabled: true, timeoutMs: 120000, maxMemoryMb: 1024 },
    );

    // 4. Wait for ready
    await this.waitForReady(port, 60000);

    // 5. Mark ready
    const previewUrl = `http://localhost:${port}`;
    await this.markReady(projectId, previewUrl);
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

  async stopPreview(projectId: string): Promise<void> {
    await this.redis.del(`preview:${projectId}`);

    // Cleanup temp directory
    const workDir = path.join(
      os.tmpdir(),
      `bv-preview-${projectId.slice(0, 8)}`,
    );
    try {
      await fs.rm(workDir, { recursive: true, force: true });
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
    this.gateway.emitToProject(projectId, 'preview:ready', { projectId, url });
    this.logger.log(`Preview ready for project ${projectId}: ${url}`);
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
