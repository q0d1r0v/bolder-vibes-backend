import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import { ChatsService } from '@/chats/chats.service';
import { CreateChatDto } from '@/chats/dto/create-chat.dto';
import { CreateMessageDto } from '@/chats/dto/create-message.dto';

@ApiTags('chats')
@ApiBearerAuth()
@Controller('projects/:projectId/chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a chat inside an owned project' })
  createChat(
    @Param('projectId') projectId: string,
    @Body() dto: CreateChatDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.createChat(projectId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List chats for an owned project' })
  listChats(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.listChats(projectId, user.id);
  }

  @Post(':chatId/messages')
  @ApiOperation({ summary: 'Add a message to an owned project chat' })
  addMessage(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.addMessage(projectId, chatId, dto, user.id);
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'List messages for an owned project chat' })
  listMessages(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.listMessages(projectId, chatId, user.id);
  }
}
