import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiProvider } from '../providers/ai-provider.interface.js';
import { AI_PROVIDER_ANTHROPIC } from '../providers/ai-provider.interface.js';
import {
  DEVELOPER_SYSTEM_PROMPT,
  buildDeveloperUserPrompt,
} from './developer.prompts.js';
import { ExecutionPlan } from '../planner/planner.interface.js';
import { DeveloperOutput } from './developer.interface.js';

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
  ): Promise<{ output: DeveloperOutput; tokenUsage: Record<string, number> }> {
    this.logger.log('Generating code...');

    const response = await this.aiProvider.complete(
      [
        { role: 'system', content: DEVELOPER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildDeveloperUserPrompt(
            JSON.stringify(plan, null, 2),
            fileContents,
            projectContext,
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
        temperature: 0.2,
        responseFormat: 'json',
      },
    );

    const output: DeveloperOutput = JSON.parse(response.content);
    this.logger.log(
      `Code generated: ${output.changes.length} file changes`,
    );

    return { output, tokenUsage: response.tokenUsage };
  }
}
