import {
  BadRequestException,
  Inject,
  forwardRef,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AiQueueService } from '@/ai/ai-queue.service';
import { ChatsService } from '@/chats/chats.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { CreatePromptRunDto } from '@/ai/dto/create-prompt-run.dto';
import { getAppConfig } from '@/config/app.config';

@Injectable()
export class AiService {
  private readonly config = getAppConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly chatsService: ChatsService,
    private readonly realtimeService: RealtimeService,
    @Inject(forwardRef(() => AiQueueService))
    private readonly aiQueueService: AiQueueService,
  ) {}

  async createPromptRun(
    projectId: string,
    dto: CreatePromptRunDto,
    ownerUserId?: string,
  ) {
    await this.projectsService.ensureProject(projectId, ownerUserId);

    if (!dto.prompt?.trim()) {
      throw new BadRequestException('prompt is required.');
    }

    if (dto.chatId) {
      await this.chatsService.assertChat(projectId, dto.chatId);
    }

    const requestedBy = ownerUserId
      ? await this.prisma.user.findUnique({
          where: { id: ownerUserId },
          select: {
            id: true,
            email: true,
          },
        })
      : dto.requestedByEmail?.trim()
        ? await this.prisma.user.upsert({
            where: { email: dto.requestedByEmail.trim().toLowerCase() },
            update: {},
            create: { email: dto.requestedByEmail.trim().toLowerCase() },
            select: {
              id: true,
              email: true,
            },
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
          provider: dto.provider ?? this.config.aiDefaultProvider,
          model: dto.model ?? this.resolveModel(dto.provider),
          prompt: dto.prompt.trim(),
          plan: buildDefaultAgentPlan(dto.prompt),
          status: 'QUEUED',
        },
      });
    });

    this.realtimeService.emitProjectEvent(projectId, 'prompt.created', {
      promptRun,
    });

    const queue = await this.aiQueueService.enqueuePromptRun(promptRun.id);

    this.realtimeService.emitProjectEvent(projectId, 'prompt.queued', {
      promptRunId: promptRun.id,
      queue,
    });

    return promptRun;
  }

  async listPromptRuns(projectId: string, ownerUserId?: string) {
    await this.projectsService.ensureProject(projectId, ownerUserId);

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
    ownerUserId?: string,
  ) {
    await this.projectsService.ensureProject(projectId, ownerUserId);

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

  async getPromptRunWithContext(promptRunId: string) {
    return this.prisma.promptRun.findUnique({
      where: { id: promptRunId },
      include: {
        project: {
          include: {
            owner: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
          },
        },
        requestedBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    }) as Promise<Prisma.PromptRunGetPayload<{
      include: {
        project: {
          include: {
            owner: {
              select: {
                id: true;
                email: true;
                displayName: true;
              };
            };
          };
        };
        requestedBy: {
          select: {
            id: true;
            email: true;
          };
        };
      };
    }> | null>;
  }

  private resolveModel(provider?: string) {
    if (provider === 'anthropic') {
      return this.config.anthropicModel;
    }

    if (provider === 'openai') {
      return this.config.openAiModel;
    }

    return provider === 'mock'
      ? 'mock-template-v1'
      : this.config.aiDefaultProvider === 'anthropic'
        ? this.config.anthropicModel
        : this.config.openAiModel;
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
