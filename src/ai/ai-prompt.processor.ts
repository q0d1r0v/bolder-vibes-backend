import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { AiProviderRegistry } from '@/ai/ai-provider.registry';
import { AiService } from '@/ai/ai.service';
import { VersionSource } from '@/common/enums/version-source.enum';
import { getAppConfig } from '@/config/app.config';
import { FilesService } from '@/files/files.service';
import { RuntimeService } from '@/runtime/runtime.service';

@Injectable()
export class AiPromptProcessor {
  private readonly logger = new Logger(AiPromptProcessor.name);
  private readonly config = getAppConfig();

  constructor(
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
    private readonly aiProviderRegistry: AiProviderRegistry,
    private readonly filesService: FilesService,
    private readonly runtimeService: RuntimeService,
  ) {}

  async processPromptRunJob(data: { promptRunId: string }) {
    const promptRun = await this.aiService.getPromptRunWithContext(
      data.promptRunId,
    );

    if (!promptRun) {
      this.logger.warn(
        `Prompt run ${data.promptRunId} not found for processing.`,
      );
      return;
    }

    await this.aiService.updatePromptStatus(
      promptRun.projectId,
      promptRun.id,
      'RUNNING',
    );

    try {
      const generatedProject = await this.aiProviderRegistry.generate({
        promptRun,
        project: promptRun.project,
      });

      await this.filesService.saveFiles(
        promptRun.projectId,
        {
          files: generatedProject.files,
          summary: generatedProject.summary,
          source: VersionSource.AI,
        },
        promptRun.project.ownerId,
      );

      if (this.config.aiAutoStartRuntime) {
        await this.runtimeService.startRuntime(
          promptRun.projectId,
          {
            note: `Auto-started by prompt run ${promptRun.id}`,
            forceRebuild: true,
          },
          promptRun.project.ownerId,
        );
      }

      await this.aiService.updatePromptStatus(
        promptRun.projectId,
        promptRun.id,
        'SUCCEEDED',
        generatedProject.summary,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown AI processing error.';

      this.logger.error(message);
      await this.aiService.updatePromptStatus(
        promptRun.projectId,
        promptRun.id,
        'FAILED',
        undefined,
        message,
      );
    }
  }
}
