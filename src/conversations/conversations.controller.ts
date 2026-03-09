import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { AgentOrchestratorService } from '@/agents/orchestrator/agent-orchestrator.service.js';
import { CreateConversationDto, CreateMessageDto } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { PaginationDto } from '@/common/dtos/index.js';

@Controller()
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly orchestrator: AgentOrchestratorService,
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
    return this.conversationsService.findAllByProject(projectId, userId, pagination);
  }

  @Get('conversations/:id')
  findOne(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.conversationsService.findById(id, userId);
  }

  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser('id') userId: string,
  ) {
    const { message, projectId } = await this.conversationsService.addMessage(
      id,
      dto,
      userId,
    );

    // Trigger AI pipeline asynchronously
    this.orchestrator
      .executeTask(projectId, id, dto.content, userId)
      .catch((err) => {
        console.error('Agent pipeline error:', err);
      });

    return message;
  }
}
