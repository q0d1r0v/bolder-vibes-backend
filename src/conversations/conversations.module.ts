import { Module, forwardRef } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { AgentsModule } from '@/agents/agents.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';

@Module({
  imports: [ProjectsModule, forwardRef(() => AgentsModule), GatewayModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
