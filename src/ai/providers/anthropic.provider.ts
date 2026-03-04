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
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly config = getAppConfig();

  async generate(context: AiProviderContext): Promise<AiGeneratedProject> {
    if (!this.config.anthropicApiKey) {
      throw new ServiceUnavailableException(
        'ANTHROPIC_API_KEY is not configured.',
      );
    }

    const response = await fetch(`${this.config.anthropicBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: context.promptRun.model || this.config.anthropicModel,
        max_tokens: 4000,
        system: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: buildUserPrompt(context),
          },
        ],
      }),
      signal: AbortSignal.timeout(this.config.aiRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Anthropic request failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    };
    const text =
      payload.content
        ?.filter((item) => item.type === 'text')
        .map((item) => item.text ?? '')
        .join('\n') ?? '';

    return parseProviderJson(
      text,
      this.name,
      context.promptRun.model || this.config.anthropicModel,
    );
  }
}
