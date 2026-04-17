import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';

const execFileAsync = promisify(execFile);

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getHealth() {
    const [database, redis, docker] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDocker(),
    ]);

    const services = { database, redis, docker };
    // Docker daemon being unreachable degrades preview/APK builds but does
    // not take down the API — report "degraded" instead of unhealthy so
    // a load balancer keeps routing auth/project traffic.
    const critical = [database, redis].every((v) => v === 'healthy');
    const all = Object.values(services).every((v) => v === 'healthy');
    return {
      status: all ? 'ok' : critical ? 'degraded' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services,
    };
  }

  private async checkDatabase(): Promise<'healthy' | 'unhealthy'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }

  private async checkRedis(): Promise<'healthy' | 'unhealthy'> {
    try {
      await this.redis.ping();
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }

  private async checkDocker(): Promise<'healthy' | 'unhealthy'> {
    try {
      await execFileAsync(
        'docker',
        ['version', '--format', '{{.Server.Version}}'],
        { timeout: 2000 },
      );
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }
}
