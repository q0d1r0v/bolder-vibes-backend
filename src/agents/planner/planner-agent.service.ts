import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiProvider } from '../providers/ai-provider.interface.js';
import { AI_PROVIDER_ANTHROPIC } from '../providers/ai-provider.interface.js';
import {
  getPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from './planner.prompts.js';
import { ExecutionPlan } from './planner.interface.js';
import { parseAiJsonResponse, validateAiOutput } from '../utils/parse-ai-response.js';
import { withRetry } from '../utils/retry.js';

@Injectable()
export class PlannerAgentService {
  private readonly logger = new Logger(PlannerAgentService.name);

  constructor(
    @Inject(AI_PROVIDER_ANTHROPIC)
    private readonly aiProvider: AiProvider,
    private readonly configService: ConfigService,
  ) {}

  async createPlan(
    userRequest: string,
    fileTree: string[],
    conversationContext: string,
    framework?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<{ plan: ExecutionPlan; tokenUsage: Record<string, number> }> {
    this.logger.log('Creating execution plan...');

    const messages = [
      { role: 'system' as const, content: getPlannerSystemPrompt(framework) },
      {
        role: 'user' as const,
        content: buildPlannerUserPrompt(
          userRequest,
          fileTree,
          conversationContext,
        ),
      },
    ];

    const options = {
      model: this.configService.get<string>('ai.anthropic.model', 'claude-sonnet-4-6-20260402'),
      maxTokens: this.configService.get<number>('ai.anthropic.maxTokens', 8192),
      temperature: 0.3,
      responseFormat: 'json' as const,
    };

    if (onChunk) {
      let fullContent = '';
      for await (const chunk of this.aiProvider.stream(messages, options)) {
        fullContent += chunk.content;
        onChunk(chunk.content);
      }

      const parsed = parseAiJsonResponse<ExecutionPlan>(fullContent, 'planner');
      const plan = validateAiOutput<ExecutionPlan>(parsed, ['reasoning', 'steps'], 'planner');
      this.logger.log(`Plan created: ${plan.steps.length} steps`);
      return { plan, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }

    const response = await withRetry(
      () => this.aiProvider.complete(messages, options),
      'PlannerAgent',
    );

    const parsed = parseAiJsonResponse<ExecutionPlan>(response.content, 'planner');
    const plan = validateAiOutput<ExecutionPlan>(parsed, ['reasoning', 'steps'], 'planner');
    this.logger.log(`Plan created: ${plan.steps.length} steps`);

    return { plan, tokenUsage: response.tokenUsage };
  }
}
