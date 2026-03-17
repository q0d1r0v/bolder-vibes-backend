import { Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service.js';
import { SandboxController } from './sandbox.controller.js';
import { DockerRunnerService } from './runners/docker-runner.service.js';
import { PreviewService } from './preview/preview.service.js';
import { RUNNER_TOKEN } from './runners/runner.interface.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';

@Module({
  imports: [ProjectsModule, GatewayModule],
  controllers: [SandboxController],
  providers: [
    {
      provide: RUNNER_TOKEN,
      useClass: DockerRunnerService,
    },
    PreviewService,
    SandboxService,
  ],
  exports: [SandboxService, PreviewService],
})
export class SandboxModule {}
