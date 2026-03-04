import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { Job, Queue, Worker } from 'bullmq';

import { AiPromptProcessor } from '@/ai/ai-prompt.processor';
import { getAppConfig } from '@/config/app.config';

type PromptRunJobData = {
  promptRunId: string;
};

@Injectable()
export class AiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly config = getAppConfig();
  private readonly logger = new Logger(AiQueueService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(forwardRef(() => AiPromptProcessor))
    private readonly processor: AiPromptProcessor,
  ) {}

  onModuleInit() {
    if (this.config.nodeEnv === 'test' || !this.config.redisUrl) {
      return;
    }

    try {
      this.connection = new IORedis(this.config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      this.queue = new Queue(this.config.aiQueueName, {
        connection: this.connection as any,
      });

      if (this.config.aiQueueProcessInline) {
        this.worker = new Worker(
          this.config.aiQueueName,
          async (job: Job<PromptRunJobData>) =>
            this.processor.processPromptRunJob(job.data),
          {
            connection: this.connection as any,
          },
        );
      }
    } catch (error) {
      this.logger.warn(
        `Redis queue bootstrap failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  async enqueuePromptRun(promptRunId: string) {
    if (this.queue) {
      await this.queue.add(
        'prompt-run',
        { promptRunId },
        {
          removeOnComplete: {
            count: 250,
          },
          removeOnFail: {
            count: 250,
          },
        },
      );

      return {
        mode: 'redis-queue',
        promptRunId,
      };
    }

    setTimeout(() => {
      void this.processor.processPromptRunJob({ promptRunId });
    }, 0);

    this.logger.warn(
      `Redis queue unavailable. Prompt run ${promptRunId} will be processed inline.`,
    );

    return {
      mode: 'inline-fallback',
      promptRunId,
    };
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }

    if (this.queue) {
      await this.queue.close();
    }

    if (this.connection) {
      await this.connection.quit();
    }
  }
}
