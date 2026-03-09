import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiProvider } from '../providers/ai-provider.interface.js';
import { AI_PROVIDER_OPENAI } from '../providers/ai-provider.interface.js';
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserPrompt,
} from './planner.prompts.js';
import { ExecutionPlan } from './planner.interface.js';

@Injectable()
export class PlannerAgentService {
  private readonly logger = new Logger(PlannerAgentService.name);

  constructor(
    @Inject(AI_PROVIDER_OPENAI)
    private readonly aiProvider: AiProvider,
    private readonly configService: ConfigService,
  ) {}

  async createPlan(
    userRequest: string,
    fileTree: string[],
    conversationContext: string,
  ): Promise<{ plan: ExecutionPlan; tokenUsage: Record<string, number> }> {
    this.logger.log('Creating execution plan...');

    const response = await this.aiProvider.complete(
      [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildPlannerUserPrompt(
            userRequest,
            fileTree,
            conversationContext,
          ),
        },
      ],
      {
        model: this.configService.get<string>('ai.openai.model', 'gpt-4'),
        maxTokens: this.configService.get<number>(
          'ai.openai.maxTokens',
          4096,
        ),
        temperature: 0.3,
        responseFormat: 'json',
      },
    );

    const plan: ExecutionPlan = JSON.parse(response.content);
    this.logger.log(`Plan created: ${plan.steps.length} steps`);

    return { plan, tokenUsage: response.tokenUsage };
  }
}
