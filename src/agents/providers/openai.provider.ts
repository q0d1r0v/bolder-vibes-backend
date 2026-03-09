import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AiProvider,
  AiProviderMessage,
  AiProviderOptions,
  AiProviderResponse,
  AiProviderStreamChunk,
} from './ai-provider.interface.js';

@Injectable()
export class OpenAIProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>('ai.openai.apiKey'),
    });
  }

  async complete(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): Promise<AiProviderResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(options.responseFormat === 'json' && {
        response_format: { type: 'json_object' },
      }),
    });

    const choice = response.choices[0];

    return {
      content: choice?.message?.content || '',
      tokenUsage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      finishReason: choice?.finish_reason || 'stop',
    };
  }

  async *stream(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): AsyncIterable<AiProviderStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          content: delta.content,
          isComplete: chunk.choices[0]?.finish_reason === 'stop',
        };
      }
    }
  }
}
