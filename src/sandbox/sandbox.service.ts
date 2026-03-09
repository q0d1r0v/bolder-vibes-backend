import { Injectable, Inject } from '@nestjs/common';
import type { Runner } from './runners/runner.interface.js';
import { RUNNER_TOKEN } from './runners/runner.interface.js';
import { PreviewService } from './preview/preview.service.js';
import { ExecutionResult, SandboxConfig } from './sandbox.interface.js';

@Injectable()
export class SandboxService {
  constructor(
    @Inject(RUNNER_TOKEN)
    private readonly runner: Runner,
    private readonly previewService: PreviewService,
  ) {}

  async executeCommand(
    projectId: string,
    command: string,
    config?: Partial<SandboxConfig>,
  ): Promise<ExecutionResult> {
    return this.runner.execute(projectId, command, config);
  }

  async startPreview(projectId: string) {
    return this.previewService.startPreview(projectId);
  }

  async getPreviewStatus(projectId: string) {
    return this.previewService.getPreviewStatus(projectId);
  }

  async stopPreview(projectId: string) {
    await this.runner.cleanup(projectId);
    await this.previewService.stopPreview(projectId);
  }
}
