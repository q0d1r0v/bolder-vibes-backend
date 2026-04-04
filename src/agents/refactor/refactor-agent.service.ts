import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiProvider } from '../providers/ai-provider.interface.js';
import { AI_PROVIDER_ANTHROPIC } from '../providers/ai-provider.interface.js';
import {
  REFACTOR_SYSTEM_PROMPT,
  buildRefactorUserPrompt,
} from './refactor.prompts.js';
import { ExecutionPlan } from '../planner/planner.interface.js';
import { DeveloperOutput } from '../developer/developer.interface.js';
import { RefactorOutput } from './refactor.interface.js';
import { parseAiJsonResponse, validateAiOutput } from '../utils/parse-ai-response.js';

@Injectable()
export class RefactorAgentService {
  private readonly logger = new Logger(RefactorAgentService.name);

  constructor(
    @Inject(AI_PROVIDER_ANTHROPIC)
    private readonly aiProvider: AiProvider,
    private readonly configService: ConfigService,
  ) {}

  async reviewAndRefactor(
    plan: ExecutionPlan,
    developerOutput: DeveloperOutput,
    onChunk?: (chunk: string) => void,
  ): Promise<{
    output: RefactorOutput;
    tokenUsage: Record<string, number>;
  }> {
    this.logger.log('Reviewing and refactoring code...');

    const messages = [
      { role: 'system' as const, content: REFACTOR_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildRefactorUserPrompt(
          JSON.stringify(plan, null, 2),
          JSON.stringify(developerOutput, null, 2),
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
      temperature: 0.1,
      responseFormat: 'json' as const,
    };

    if (onChunk) {
      let fullContent = '';
      for await (const chunk of this.aiProvider.stream(messages, options)) {
        fullContent += chunk.content;
        onChunk(chunk.content);
      }

      const parsed = parseAiJsonResponse<RefactorOutput>(fullContent, 'refactor');
      const output = validateAiOutput<RefactorOutput>(parsed, ['changes', 'qualityReport'], 'refactor');
      this.logger.log(
        `Refactor complete: ${output.qualityReport.issuesFound} issues found`,
      );
      return { output, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }

    const response = await this.aiProvider.complete(messages, options);

    const parsed = parseAiJsonResponse<RefactorOutput>(response.content, 'refactor');
    const output = validateAiOutput<RefactorOutput>(parsed, ['changes', 'qualityReport'], 'refactor');
    this.logger.log(
      `Refactor complete: ${output.qualityReport.issuesFound} issues found`,
    );

    return { output, tokenUsage: response.tokenUsage };
  }
}
