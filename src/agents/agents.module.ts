import { Module } from '@nestjs/common';
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service.js';
import { PlannerAgentService } from './planner/planner-agent.service.js';
import { DeveloperAgentService } from './developer/developer-agent.service.js';
import { RefactorAgentService } from './refactor/refactor-agent.service.js';
import { OpenAIProvider } from './providers/openai.provider.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import {
  AI_PROVIDER_OPENAI,
  AI_PROVIDER_ANTHROPIC,
} from './providers/ai-provider.interface.js';
import { FilesModule } from '@/files/files.module.js';

@Module({
  imports: [FilesModule],
  providers: [
    {
      provide: AI_PROVIDER_OPENAI,
      useClass: OpenAIProvider,
    },
    {
      provide: AI_PROVIDER_ANTHROPIC,
      useClass: AnthropicProvider,
    },
    PlannerAgentService,
    DeveloperAgentService,
    RefactorAgentService,
    AgentOrchestratorService,
  ],
  exports: [AgentOrchestratorService],
})
export class AgentsModule {}
