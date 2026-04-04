import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto, CreateMessageDto } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { PaginationDto } from '@/common/dtos/index.js';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller()
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post('projects/:projectId/conversations')
  create(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Body() dto: CreateConversationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.create(projectId, dto, userId);
  }

  @Get('projects/:projectId/conversations')
  findByProject(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.conversationsService.findAllByProject(
      projectId,
      userId,
      pagination,
    );
  }

  @Get('conversations/:id')
  findOne(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.findById(id, userId);
  }

  @Delete('conversations/:id')
  remove(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.remove(id, userId);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser('id') userId: string,
  ) {
    const { message } = await this.conversationsService.addMessage(
      id,
      dto,
      userId,
    );
    return message;
  }
}
