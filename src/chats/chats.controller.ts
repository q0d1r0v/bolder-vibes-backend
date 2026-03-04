import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { ChatsService } from '@/chats/chats.service';
import { CreateChatDto } from '@/chats/dto/create-chat.dto';
import { CreateMessageDto } from '@/chats/dto/create-message.dto';

@Controller('projects/:projectId/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post()
  createChat(
    @Param('projectId') projectId: string,
    @Body() dto: CreateChatDto,
  ) {
    return this.chatsService.createChat(projectId, dto);
  }

  @Get()
  listChats(@Param('projectId') projectId: string) {
    return this.chatsService.listChats(projectId);
  }

  @Post(':chatId/messages')
  addMessage(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatsService.addMessage(projectId, chatId, dto);
  }

  @Get(':chatId/messages')
  listMessages(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
  ) {
    return this.chatsService.listMessages(projectId, chatId);
  }
}
