import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ChatsService } from '@/chats/chats.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { CreatePromptRunDto } from '@/ai/dto/create-prompt-run.dto';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly chatsService: ChatsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async createPromptRun(projectId: string, dto: CreatePromptRunDto) {
    await this.projectsService.ensureProject(projectId);

    if (!dto.prompt?.trim()) {
      throw new BadRequestException('prompt is required.');
    }

    if (dto.chatId) {
      await this.chatsService.assertChat(projectId, dto.chatId);
    }

    const requestedBy = dto.requestedByEmail?.trim()
      ? await this.prisma.user.upsert({
          where: { email: dto.requestedByEmail.trim() },
          update: {},
          create: { email: dto.requestedByEmail.trim() },
        })
      : null;

    const promptRun = await this.prisma.$transaction(async (transaction) => {
      if (dto.chatId && dto.autoRecordUserMessage) {
        await transaction.projectMessage.create({
          data: {
            chatId: dto.chatId,
            role: 'USER',
            content: dto.prompt.trim(),
          },
        });
      }

      return transaction.promptRun.create({
        data: {
          projectId,
          chatId: dto.chatId,
          requestedById: requestedBy?.id,
          provider: dto.provider ?? 'openai',
          model: dto.model ?? 'gpt-4.1',
          prompt: dto.prompt.trim(),
          plan: buildDefaultAgentPlan(dto.prompt),
          status: 'QUEUED',
        },
      });
    });

    this.realtimeService.emitProjectEvent(projectId, 'prompt.created', {
      promptRun,
    });

    return promptRun;
  }

  async listPromptRuns(projectId: string) {
    await this.projectsService.ensureProject(projectId);

    return this.prisma.promptRun.findMany({
      where: { projectId },
      include: {
        chat: {
          select: {
            id: true,
            title: true,
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updatePromptStatus(
    projectId: string,
    promptRunId: string,
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED',
    summary?: string,
    errorMessage?: string,
  ) {
    await this.projectsService.ensureProject(projectId);

    const existingPromptRun = await this.prisma.promptRun.findFirst({
      where: {
        id: promptRunId,
        projectId,
      },
      select: {
        id: true,
      },
    });

    if (!existingPromptRun) {
      throw new NotFoundException(
        `Prompt run ${promptRunId} was not found for project ${projectId}.`,
      );
    }

    const promptRun = await this.prisma.promptRun.update({
      where: { id: promptRunId },
      data: {
        status,
        resultSummary: summary,
        errorMessage,
        startedAt: status === 'RUNNING' ? new Date() : undefined,
        completedAt:
          status === 'SUCCEEDED' || status === 'FAILED'
            ? new Date()
            : undefined,
      },
    });

    this.realtimeService.emitProjectEvent(projectId, 'prompt.updated', {
      promptRun,
    });

    return promptRun;
  }
}

function buildDefaultAgentPlan(prompt: string) {
  return {
    summary: prompt,
    stages: [
      'plan scope',
      'generate files',
      'persist project files',
      'create version snapshot',
      'build runtime image',
      'run preview sandbox',
    ],
  };
}
