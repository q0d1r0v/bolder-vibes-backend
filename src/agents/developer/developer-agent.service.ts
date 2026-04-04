import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiProvider } from '../providers/ai-provider.interface.js';
import { AI_PROVIDER_ANTHROPIC } from '../providers/ai-provider.interface.js';
import {
  getDeveloperSystemPrompt,
  buildDeveloperUserPrompt,
} from './developer.prompts.js';
import { ExecutionPlan } from '../planner/planner.interface.js';
import { DeveloperOutput } from './developer.interface.js';
import { parseAiJsonResponse, validateAiOutput } from '../utils/parse-ai-response.js';
import { withRetry } from '../utils/retry.js';

@Injectable()
export class DeveloperAgentService {
  private readonly logger = new Logger(DeveloperAgentService.name);

  constructor(
    @Inject(AI_PROVIDER_ANTHROPIC)
    private readonly aiProvider: AiProvider,
    private readonly configService: ConfigService,
  ) {}

  async generateCode(
    plan: ExecutionPlan,
    fileContents: { path: string; content: string }[],
    projectContext: string,
    framework?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<{ output: DeveloperOutput; tokenUsage: Record<string, number> }> {
    this.logger.log('Generating code...');

    const messages = [
      { role: 'system' as const, content: getDeveloperSystemPrompt(framework) },
      {
        role: 'user' as const,
        content: buildDeveloperUserPrompt(
          JSON.stringify(plan, null, 2),
          fileContents,
          projectContext,
        ),
      },
    ];

    const options = {
      model: this.configService.get<string>(
        'ai.anthropic.model',
        'claude-sonnet-4-6-20260402',
      ),
      maxTokens: this.configService.get<number>(
        'ai.anthropic.maxTokens',
        8192,
      ),
      temperature: 0.2,
      responseFormat: 'json' as const,
    };

    if (onChunk) {
      let fullContent = '';
      for await (const chunk of this.aiProvider.stream(messages, options)) {
        fullContent += chunk.content;
        onChunk(chunk.content);
      }

      const parsed = parseAiJsonResponse<DeveloperOutput>(fullContent, 'developer');
      const output = validateAiOutput<DeveloperOutput>(parsed, ['changes', 'summary'], 'developer');
      this.logger.log(`Code generated: ${output.changes.length} file changes`);
      return { output, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }

    const response = await withRetry(
      () => this.aiProvider.complete(messages, options),
      'DeveloperAgent',
    );

    const parsed = parseAiJsonResponse<DeveloperOutput>(response.content, 'developer');
    const output = validateAiOutput<DeveloperOutput>(parsed, ['changes', 'summary'], 'developer');
    this.logger.log(`Code generated: ${output.changes.length} file changes`);

    return { output, tokenUsage: response.tokenUsage };
  }
}
