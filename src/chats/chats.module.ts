import { Module } from '@nestjs/common';

import { ChatsController } from '@/chats/chats.controller';
import { ChatsService } from '@/chats/chats.service';
import { ProjectsModule } from '@/projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
