import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { EventsGateway } from '@/gateway/events.gateway.js';
import { CreateConversationDto, CreateMessageDto } from './dtos/index.js';
import { PaginationDto, PaginatedResponseDto } from '@/common/dtos/index.js';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly gateway: EventsGateway,
  ) {}

  private async findOwnedConversation(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async create(projectId: string, dto: CreateConversationDto, userId: string) {
    await this.projectsService.findById(projectId, userId);

    return this.prisma.conversation.create({
      data: {
        title: dto.title || 'New Conversation',
        projectId,
        userId,
      },
    });
  }

  async findAllByProject(
    projectId: string,
    userId: string,
    pagination: PaginationDto,
  ) {
    await this.projectsService.findById(projectId, userId);

    const where = { projectId, userId };
    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { messages: true } } },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return new PaginatedResponseDto(
      conversations,
      total,
      pagination.page!,
      pagination.limit!,
    );
  }

  async findById(id: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async addMessage(
    conversationId: string,
    dto: CreateMessageDto,
    userId: string,
  ) {
    const conversation = await this.findOwnedConversation(
      conversationId,
      userId,
    );

    const message = await this.prisma.message.create({
      data: {
        role: 'USER',
        content: dto.content,
        conversationId: conversation.id,
      },
    });

    this.gateway.emitMessage(
      conversation.projectId,
      message.id,
      'USER',
      dto.content,
    );

    return { message, projectId: conversation.projectId };
  }

  async remove(id: string, userId: string) {
    await this.findOwnedConversation(id, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.agentTask.updateMany({
        where: { conversationId: id },
        data: { conversationId: null },
      });

      await tx.conversation.delete({
        where: { id },
      });
    });

    return { deleted: true };
  }

  async addAssistantMessage(
    conversationId: string,
    content: string,
    agentTaskId?: string,
  ) {
    return this.prisma.message.create({
      data: {
        role: 'ASSISTANT',
        content,
        conversationId,
        agentTaskId,
      },
    });
  }
}
