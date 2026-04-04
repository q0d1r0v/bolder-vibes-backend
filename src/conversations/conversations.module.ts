import { Module, forwardRef } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { ChatAiService } from './chat-ai.service.js';
import { ConversationsController } from './conversations.controller.js';
import { AiModelsController } from './ai-models.controller.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';
import { SandboxModule } from '@/sandbox/sandbox.module.js';

@Module({
  imports: [ProjectsModule, forwardRef(() => GatewayModule), forwardRef(() => SandboxModule)],
  controllers: [ConversationsController, AiModelsController],
  providers: [ConversationsService, ChatAiService],
  exports: [ConversationsService, ChatAiService],
})
export class ConversationsModule {}
