import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProvider,
  AiProviderMessage,
  AiProviderOptions,
  AiProviderResponse,
  AiProviderStreamChunk,
} from './ai-provider.interface.js';

@Injectable()
export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor(private readonly configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropic.apiKey'),
    });
  }

  async complete(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): Promise<AiProviderResponse> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
      ...(systemMessage && { system: systemMessage.content }),
      messages: nonSystemMessages,
    });

    const textBlock = response.content.find((c) => c.type === 'text');

    return {
      content: textBlock?.text || '',
      tokenUsage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      finishReason: response.stop_reason || 'end_turn',
    };
  }

  async *stream(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): AsyncIterable<AiProviderStreamChunk> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.7,
      ...(systemMessage && { system: systemMessage.content }),
      messages: nonSystemMessages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield {
          content: event.delta.text,
          isComplete: false,
        };
      }
      if (event.type === 'message_stop') {
        yield {
          content: '',
          isComplete: true,
        };
      }
    }
  }
}
