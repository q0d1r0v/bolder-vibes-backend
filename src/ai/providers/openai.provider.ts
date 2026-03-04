import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { AiGeneratedProject } from '@/ai/interfaces/ai-generated-project.interface';
import type {
  AiProvider,
  AiProviderContext,
} from '@/ai/interfaces/ai-provider.interface';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseProviderJson,
} from '@/ai/providers/provider-prompt.utils';
import { getAppConfig } from '@/config/app.config';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly config = getAppConfig();

  async generate(context: AiProviderContext): Promise<AiGeneratedProject> {
    if (!this.config.openAiApiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured.',
      );
    }

    const response = await fetch(
      `${this.config.openAiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: context.promptRun.model || this.config.openAiModel,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(),
            },
            {
              role: 'user',
              content: buildUserPrompt(context),
            },
          ],
        }),
        signal: AbortSignal.timeout(this.config.aiRequestTimeoutMs),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenAI request failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const text = payload.choices?.[0]?.message?.content ?? '';

    return parseProviderJson(
      text,
      this.name,
      context.promptRun.model || this.config.openAiModel,
    );
  }
}
