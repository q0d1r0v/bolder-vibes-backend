import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/redis/redis.service.js';
import { PreviewStatus, PreviewState } from './preview.interface.js';

@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  constructor(private readonly redis: RedisService) {}

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

    this.logger.log(`Preview build started for project ${projectId}`);

    // In production, this would trigger a Docker container build
    // For now, return the building state
    return state;
  }

  async getPreviewStatus(projectId: string): Promise<PreviewState> {
    const data = await this.redis.get(`preview:${projectId}`);
    if (!data) {
      return {
        projectId,
        status: PreviewStatus.IDLE,
      };
    }
    return JSON.parse(data);
  }

  async stopPreview(projectId: string): Promise<void> {
    await this.redis.del(`preview:${projectId}`);
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
  }
}
