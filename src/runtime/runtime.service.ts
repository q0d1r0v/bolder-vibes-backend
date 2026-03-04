import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectStatus } from '@/common/enums/project-status.enum';
import { RuntimeStatus } from '@/common/enums/runtime-status.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { RuntimeActionDto } from '@/runtime/dto/runtime-action.dto';
import { RuntimeCommandFactory } from '@/runtime/runtime-command.factory';

@Injectable()
export class RuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly runtimeCommandFactory: RuntimeCommandFactory,
    private readonly realtimeService: RealtimeService,
  ) {}

  async getRuntime(projectId: string) {
    await this.projectsService.ensureProject(projectId);

    const runtime = await this.prisma.sandboxRuntime.findUnique({
      where: { projectId },
      include: {
        events: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 20,
        },
      },
    });

    if (!runtime) {
      throw new NotFoundException(
        `Runtime for project ${projectId} was not found.`,
      );
    }

    return runtime;
  }

  async startRuntime(projectId: string, dto: RuntimeActionDto) {
    const project = await this.projectsService.ensureProject(projectId);
    const commandSet = this.runtimeCommandFactory.build(projectId, dto.port);

    await this.prisma.$transaction(async (transaction) => {
      const runtime = await transaction.sandboxRuntime.upsert({
        where: { projectId },
        create: {
          projectId,
          provider: 'DOCKER',
          status: 'RUNNING',
          containerName: commandSet.containerName,
          imageTag: commandSet.imageTag,
          hostPort: commandSet.hostPort,
          previewUrl: commandSet.previewUrl,
          lastCommand: dto.forceRebuild
            ? `${commandSet.buildCommand} && ${commandSet.startCommand}`
            : commandSet.startCommand,
          cpuLimit: commandSet.cpuLimit,
          memoryLimitMb: commandSet.memoryLimitMb,
          networkMode: commandSet.networkMode,
          startedAt: new Date(),
        },
        update: {
          status: 'RUNNING',
          containerName: commandSet.containerName,
          imageTag: commandSet.imageTag,
          hostPort: commandSet.hostPort,
          previewUrl: commandSet.previewUrl,
          lastCommand: dto.forceRebuild
            ? `${commandSet.buildCommand} && ${commandSet.startCommand}`
            : commandSet.startCommand,
          startedAt: new Date(),
          stoppedAt: null,
        },
      });

      await transaction.runtimeEvent.createMany({
        data: [
          {
            runtimeId: runtime.id,
            type: 'build',
            message: dto.forceRebuild
              ? 'Sandbox image rebuild requested.'
              : 'Sandbox start requested.',
            payload: {
              buildCommand: commandSet.buildCommand,
              startCommand: commandSet.startCommand,
              requestedBy: dto.requestedBy,
              note: dto.note,
            },
          },
          {
            runtimeId: runtime.id,
            type: 'preview',
            message: 'Preview URL reserved for project runtime.',
            payload: {
              previewUrl: commandSet.previewUrl,
              hostPort: commandSet.hostPort,
            },
          },
        ],
      });

      await transaction.project.update({
        where: { id: project.id },
        data: {
          status: ProjectStatus.READY,
          previewUrl: commandSet.previewUrl,
        },
      });
    });

    const runtime = await this.getRuntime(projectId);

    this.realtimeService.emitProjectEvent(projectId, 'runtime.updated', {
      action: 'start',
      runtime,
    });

    return runtime;
  }

  async stopRuntime(projectId: string, dto: RuntimeActionDto) {
    const runtime = await this.getRuntime(projectId);
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      runtime.hostPort ?? dto.port,
    );

    await this.prisma.$transaction([
      this.prisma.sandboxRuntime.update({
        where: { projectId },
        data: {
          status: RuntimeStatus.STOPPED,
          stoppedAt: new Date(),
          lastCommand: commandSet.stopCommand,
        },
      }),
      this.prisma.runtimeEvent.create({
        data: {
          runtimeId: runtime.id,
          type: 'stop',
          message: 'Sandbox stop requested.',
          payload: {
            stopCommand: commandSet.stopCommand,
            requestedBy: dto.requestedBy,
            note: dto.note,
          },
        },
      }),
    ]);

    const updatedRuntime = await this.getRuntime(projectId);

    this.realtimeService.emitProjectEvent(projectId, 'runtime.updated', {
      action: 'stop',
      runtime: updatedRuntime,
    });

    return updatedRuntime;
  }

  async restartRuntime(projectId: string, dto: RuntimeActionDto) {
    const runtime = await this.getRuntime(projectId);
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      dto.port ?? runtime.hostPort ?? undefined,
    );

    await this.prisma.$transaction([
      this.prisma.sandboxRuntime.update({
        where: { projectId },
        data: {
          status: RuntimeStatus.RUNNING,
          stoppedAt: null,
          startedAt: new Date(),
          previewUrl: commandSet.previewUrl,
          lastCommand: `${commandSet.stopCommand} && ${commandSet.startCommand}`,
        },
      }),
      this.prisma.runtimeEvent.create({
        data: {
          runtimeId: runtime.id,
          type: 'restart',
          message: 'Sandbox restart requested.',
          payload: {
            restartCommand: `${commandSet.stopCommand} && ${commandSet.startCommand}`,
            requestedBy: dto.requestedBy,
            note: dto.note,
          },
        },
      }),
    ]);

    const updatedRuntime = await this.getRuntime(projectId);

    this.realtimeService.emitProjectEvent(projectId, 'runtime.updated', {
      action: 'restart',
      runtime: updatedRuntime,
    });

    return updatedRuntime;
  }
}
