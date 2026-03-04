import { Injectable } from '@nestjs/common';

import type { AiGeneratedProject } from '@/ai/interfaces/ai-generated-project.interface';
import type { AiProviderContext } from '@/ai/interfaces/ai-provider.interface';
import { AnthropicProvider } from '@/ai/providers/anthropic.provider';
import { MockAiProvider } from '@/ai/providers/mock-ai.provider';
import { OpenAiProvider } from '@/ai/providers/openai.provider';
import { getAppConfig } from '@/config/app.config';

@Injectable()
export class AiProviderRegistry {
  private readonly config = getAppConfig();

  constructor(
    private readonly openAiProvider: OpenAiProvider,
    private readonly anthropicProvider: AnthropicProvider,
    private readonly mockAiProvider: MockAiProvider,
  ) {}

  async generate(context: AiProviderContext): Promise<AiGeneratedProject> {
    const requestedProvider =
      context.promptRun.provider || this.config.aiDefaultProvider;

    if (requestedProvider === 'openai') {
      if (!this.config.openAiApiKey) {
        return this.mockAiProvider.generate(context);
      }

      return this.openAiProvider.generate(context);
    }

    if (requestedProvider === 'anthropic') {
      if (!this.config.anthropicApiKey) {
        return this.mockAiProvider.generate(context);
      }

      return this.anthropicProvider.generate(context);
    }

    return this.mockAiProvider.generate(context);
  }
}
