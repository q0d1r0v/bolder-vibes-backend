export interface AiProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiProviderOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface AiProviderResponse {
  content: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
}

export interface AiProviderStreamChunk {
  content: string;
  isComplete: boolean;
}

export interface AiProvider {
  complete(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): Promise<AiProviderResponse>;

  stream(
    messages: AiProviderMessage[],
    options: AiProviderOptions,
  ): AsyncIterable<AiProviderStreamChunk>;
}

export const AI_PROVIDER_OPENAI = 'AI_PROVIDER_OPENAI';
export const AI_PROVIDER_ANTHROPIC = 'AI_PROVIDER_ANTHROPIC';
