import { Module, forwardRef } from '@nestjs/common';
import { SandboxService } from './sandbox.service.js';
import { SandboxController } from './sandbox.controller.js';
import { PreviewProxyController } from './preview/preview-proxy.controller.js';
import { DockerRunnerService } from './runners/docker-runner.service.js';
import { PreviewService } from './preview/preview.service.js';
import { NativePreviewService } from './preview/native-preview.service.js';
import { NativePreviewController } from './preview/native-preview.controller.js';
import { ApkBuildService } from './apk-build/apk-build.service.js';
import { ApkBuildController } from './apk-build/apk-build.controller.js';
import { RUNNER_TOKEN } from './runners/runner.interface.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';
import { UsersModule } from '@/users/users.module.js';

@Module({
  imports: [ProjectsModule, UsersModule, forwardRef(() => GatewayModule)],
  controllers: [
    SandboxController,
    PreviewProxyController,
    NativePreviewController,
    ApkBuildController,
  ],
  providers: [
    {
      provide: RUNNER_TOKEN,
      useClass: DockerRunnerService,
    },
    PreviewService,
    NativePreviewService,
    ApkBuildService,
    SandboxService,
  ],
  exports: [
    SandboxService,
    PreviewService,
    NativePreviewService,
    ApkBuildService,
  ],
})
export class SandboxModule {}
