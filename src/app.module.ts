import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CommonModule } from './common/common.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { FilesModule } from './files/files.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { SandboxModule } from './sandbox/sandbox.module.js';
import { JwtAuthGuard } from './common/guards/index.js';
import { RolesGuard } from './common/guards/index.js';
import {
  appConfig,
  authConfig,
  databaseConfig,
  redisConfig,
  aiConfig,
  corsConfig,
  envValidationSchema,
} from './config/index.js';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        redisConfig,
        aiConfig,
        corsConfig,
      ],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'short',
            ttl: 1000,
            limit: 10,
          },
          {
            name: 'medium',
            ttl: 10000,
            limit: 50,
          },
          {
            name: 'long',
            ttl: config.get<number>('THROTTLE_TTL', 60000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    CommonModule,

    // Features
    AuthModule,
    UsersModule,
    ProjectsModule,
    FilesModule,
    ConversationsModule,
    AgentsModule,
    GatewayModule,
    SandboxModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
