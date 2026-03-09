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
  ): Promise<{
    output: RefactorOutput;
    tokenUsage: Record<string, number>;
  }> {
    this.logger.log('Reviewing and refactoring code...');

    const response = await this.aiProvider.complete(
      [
        { role: 'system', content: REFACTOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRefactorUserPrompt(
            JSON.stringify(plan, null, 2),
            JSON.stringify(developerOutput, null, 2),
          ),
        },
      ],
      {
        model: this.configService.get<string>(
          'ai.anthropic.model',
          'claude-sonnet-4-20250514',
        ),
        maxTokens: this.configService.get<number>(
          'ai.anthropic.maxTokens',
          8192,
        ),
        temperature: 0.1,
        responseFormat: 'json',
      },
    );

    const output: RefactorOutput = JSON.parse(response.content);
    this.logger.log(
      `Refactor complete: ${output.qualityReport.issuesFound} issues found`,
    );

    return { output, tokenUsage: response.tokenUsage };
  }
}
