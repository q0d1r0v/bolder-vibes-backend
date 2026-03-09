import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(private readonly configService: ConfigService) {
    const host = configService.get<string>('redis.host', 'localhost');
    const port = configService.get<number>('redis.port', 6379);
    const password = configService.get<string>('redis.password');

    super({
      host,
      port,
      password: password || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
