import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway.js';
import { AgentsModule } from '@/agents/agents.module.js';
import { ConversationsModule } from '@/conversations/conversations.module.js';

@Module({
  imports: [
    JwtModule.register({}),
    forwardRef(() => AgentsModule),
    forwardRef(() => ConversationsModule),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class GatewayModule {}
