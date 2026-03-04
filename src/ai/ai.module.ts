import { Module } from '@nestjs/common';

import { AiController } from '@/ai/ai.controller';
import { AiService } from '@/ai/ai.service';
import { ChatsModule } from '@/chats/chats.module';
import { ProjectsModule } from '@/projects/projects.module';

@Module({
  imports: [ProjectsModule, ChatsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
