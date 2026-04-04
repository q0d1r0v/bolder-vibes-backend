import { Module, forwardRef } from '@nestjs/common';
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service.js';
import { PlannerAgentService } from './planner/planner-agent.service.js';
import { DeveloperAgentService } from './developer/developer-agent.service.js';
import { RefactorAgentService } from './refactor/refactor-agent.service.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { AI_PROVIDER_ANTHROPIC } from './providers/ai-provider.interface.js';
import { AgentsController } from './agents.controller.js';
import { FilesModule } from '@/files/files.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { SandboxModule } from '@/sandbox/sandbox.module.js';

@Module({
  imports: [forwardRef(() => FilesModule), forwardRef(() => GatewayModule), ProjectsModule, forwardRef(() => SandboxModule)],
  controllers: [AgentsController],
  providers: [
    {
      provide: AI_PROVIDER_ANTHROPIC,
      useClass: AnthropicProvider,
    },
    PlannerAgentService,
    DeveloperAgentService,
    RefactorAgentService,
    AgentOrchestratorService,
  ],
  exports: [AgentOrchestratorService, AI_PROVIDER_ANTHROPIC],
})
export class AgentsModule {}
