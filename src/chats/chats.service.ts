import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MessageRole } from '@/common/enums/message-role.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { CreateChatDto } from '@/chats/dto/create-chat.dto';
import { CreateMessageDto } from '@/chats/dto/create-message.dto';

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async createChat(projectId: string, dto: CreateChatDto) {
    await this.projectsService.ensureProject(projectId);

    if (!dto.title?.trim()) {
      throw new BadRequestException('title is required.');
    }

    const chat = await this.prisma.projectChat.create({
      data: {
        projectId,
        title: dto.title.trim(),
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    this.realtimeService.emitProjectEvent(projectId, 'chat.created', {
      chat,
    });

    return chat;
  }

  async listChats(projectId: string) {
    await this.projectsService.ensureProject(projectId);

    return this.prisma.projectChat.findMany({
      where: { projectId },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });
  }

  async addMessage(projectId: string, chatId: string, dto: CreateMessageDto) {
    await this.assertChat(projectId, chatId);

    if (!dto.content?.trim()) {
      throw new BadRequestException('content is required.');
    }

    const role = Object.values(MessageRole).includes(dto.role)
      ? dto.role
      : MessageRole.USER;

    const message = await this.prisma.projectMessage.create({
      data: {
        chatId,
        role,
        content: dto.content.trim(),
        model: dto.model?.trim(),
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    this.realtimeService.emitProjectEvent(projectId, 'chat.message.created', {
      chatId,
      message,
    });

    return message;
  }

  async listMessages(projectId: string, chatId: string) {
    await this.assertChat(projectId, chatId);

    return this.prisma.projectMessage.findMany({
      where: { chatId },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async assertChat(projectId: string, chatId: string) {
    const chat = await this.prisma.projectChat.findFirst({
      where: {
        id: chatId,
        projectId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!chat) {
      throw new NotFoundException(
        `Chat ${chatId} was not found for project ${projectId}.`,
      );
    }

    return chat;
  }
}
