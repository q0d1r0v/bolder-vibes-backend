import { Injectable } from '@nestjs/common';

import { getAppConfig } from '@/config/app.config';

@Injectable()
export class AppService {
  private readonly config = getAppConfig();

  getOverview() {
    return {
      name: this.config.appName,
      apiPrefix: this.config.apiPrefix,
      environment: this.config.nodeEnv,
      previewBaseUrl: this.config.previewBaseUrl,
      workflow: [
        'create-project',
        'start-chat',
        'generate-files',
        'save-version',
        'build-sandbox',
        'run-sandbox',
        'preview-update',
      ],
      modules: ['projects', 'files', 'chats', 'ai', 'runtime', 'health'],
      notes: [
        'Swagger is enabled automatically when @nestjs/swagger is installed.',
        'DTO runtime validation is enabled automatically when class-validator and class-transformer are installed.',
        'Runtime commands are generated for Docker sandbox execution and can be consumed by workers.',
      ],
    };
  }

  getArchitecture() {
    return {
      agents: [
        'Planner Agent',
        'Architecture Agent',
        'Code Generator Agent',
        'Code Editor Agent',
        'Fix Agent',
      ],
      corePhases: [
        'foundation',
        'agent-workflow',
        'code-editing-system',
        'runtime',
        'sandbox',
        'infrastructure',
      ],
      minimalMvp: {
        frontend: ['next.js', 'tailwind', 'monaco', 'realtime-preview'],
        backend: ['nestjs', 'postgresql', 'prisma', 'redis-ready'],
        runtime: ['docker build', 'docker run', 'preview URL'],
      },
      criticalPath:
        'chat -> generate app -> save files -> run sandbox -> preview',
    };
  }
}
