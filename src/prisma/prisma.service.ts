import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: PrismaClient | null;
  private pool: { end?: () => Promise<void> } | null = null;

  constructor() {
    this.client = this.createClient();
  }

  get user() {
    return this.requireClient().user;
  }

  get project() {
    return this.requireClient().project;
  }

  get projectChat() {
    return this.requireClient().projectChat;
  }

  get projectMessage() {
    return this.requireClient().projectMessage;
  }

  get projectFile() {
    return this.requireClient().projectFile;
  }

  get projectVersion() {
    return this.requireClient().projectVersion;
  }

  get promptRun() {
    return this.requireClient().promptRun;
  }

  get sandboxRuntime() {
    return this.requireClient().sandboxRuntime;
  }

  get runtimeEvent() {
    return this.requireClient().runtimeEvent;
  }

  async onModuleInit() {
    if (!this.client) {
      return;
    }

    await this.client.$connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.$disconnect();
    }

    if (this.pool?.end) {
      await this.pool.end();
    }
  }

  $transaction(...args: any[]) {
    return (this.requireClient() as any).$transaction(...args);
  }

  private createClient() {
    if (
      process.env.SKIP_DB_CONNECT === 'true' ||
      process.env.NODE_ENV === 'test'
    ) {
      this.logger.log('Skipping Prisma client bootstrap.');
      return null;
    }

    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL is missing. Prisma client disabled.');
      return null;
    }

    if (
      !this.isPackageInstalled('@prisma/adapter-pg') ||
      !this.isPackageInstalled('pg')
    ) {
      this.logger.warn(
        'Prisma PostgreSQL adapter is not installed. Install @prisma/adapter-pg and pg to enable database access.',
      );
      return null;
    }

    const dynamicRequire = eval('require') as NodeRequire;
    const { PrismaPg } = dynamicRequire('@prisma/adapter-pg') as {
      PrismaPg: new (pool: unknown) => unknown;
    };
    const { Pool } = dynamicRequire('pg') as {
      Pool: new (options: { connectionString: string }) => {
        end: () => Promise<void>;
      };
    };

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    return new PrismaClient({
      adapter: new PrismaPg(this.pool) as any,
      log: ['warn', 'error'],
    });
  }

  private requireClient() {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Database layer is not active. Install @prisma/adapter-pg and pg, then set DATABASE_URL.',
      );
    }

    return this.client;
  }

  private isPackageInstalled(packageName: string) {
    try {
      const dynamicRequire = eval('require') as NodeRequire;
      dynamicRequire.resolve(packageName);
      return true;
    } catch {
      return false;
    }
  }
}
