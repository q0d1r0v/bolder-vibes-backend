import { Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service.js';
import { DockerRunnerService } from './runners/docker-runner.service.js';
import { PreviewService } from './preview/preview.service.js';
import { RUNNER_TOKEN } from './runners/runner.interface.js';

@Module({
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
