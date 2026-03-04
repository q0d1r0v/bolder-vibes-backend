import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ProjectStatus } from '@/common/enums/project-status.enum';
import { RuntimeStatus } from '@/common/enums/runtime-status.enum';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectsService } from '@/projects/projects.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { RuntimeActionDto } from '@/runtime/dto/runtime-action.dto';
import { RuntimeCommandFactory } from '@/runtime/runtime-command.factory';
import { SandboxExecutorService } from '@/runtime/sandbox-executor.service';

@Injectable()
export class RuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly runtimeCommandFactory: RuntimeCommandFactory,
    private readonly realtimeService: RealtimeService,
    private readonly sandboxExecutorService: SandboxExecutorService,
  ) {}

  async getRuntime(projectId: string, ownerUserId?: string) {
    await this.projectsService.ensureProject(projectId, ownerUserId);

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

  async startRuntime(
    projectId: string,
    dto: RuntimeActionDto,
    ownerUserId?: string,
  ) {
    const project = await this.projectsService.ensureProject(
      projectId,
      ownerUserId,
    );
    const commandSet = this.runtimeCommandFactory.build(projectId, dto.port);
    const requestedBy = dto.requestedBy ?? ownerUserId ?? 'system';

    let execution: unknown;

    try {
      execution = await this.sandboxExecutorService.startProject(
        projectId,
        dto.port,
        dto.forceRebuild,
      );
    } catch (error) {
      await this.persistRuntimeFailure(projectId, 'start', commandSet, error);
      throw new BadGatewayException(
        error instanceof Error ? error.message : 'Runtime start failed.',
      );
    }

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
              execution: execution as Prisma.InputJsonValue,
              requestedBy,
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

  async stopRuntime(
    projectId: string,
    dto: RuntimeActionDto,
    ownerUserId?: string,
  ) {
    const runtime = await this.getRuntime(projectId, ownerUserId);
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      runtime.hostPort ?? dto.port,
    );
    const requestedBy = dto.requestedBy ?? ownerUserId ?? 'system';
    let execution: unknown;

    try {
      execution = await this.sandboxExecutorService.stopProject(
        projectId,
        runtime.hostPort ?? dto.port,
      );
    } catch (error) {
      await this.persistRuntimeFailure(projectId, 'stop', commandSet, error);
      throw new BadGatewayException(
        error instanceof Error ? error.message : 'Runtime stop failed.',
      );
    }

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
            execution: execution as Prisma.InputJsonValue,
            requestedBy,
            note: dto.note,
          },
        },
      }),
    ]);

    const updatedRuntime = await this.getRuntime(projectId, ownerUserId);

    this.realtimeService.emitProjectEvent(projectId, 'runtime.updated', {
      action: 'stop',
      runtime: updatedRuntime,
    });

    return updatedRuntime;
  }

  async restartRuntime(
    projectId: string,
    dto: RuntimeActionDto,
    ownerUserId?: string,
  ) {
    const runtime = await this.getRuntime(projectId, ownerUserId);
    const commandSet = this.runtimeCommandFactory.build(
      projectId,
      dto.port ?? runtime.hostPort ?? undefined,
    );
    const requestedBy = dto.requestedBy ?? ownerUserId ?? 'system';
    let execution: unknown;

    try {
      execution = await this.sandboxExecutorService.restartProject(
        projectId,
        dto.port ?? runtime.hostPort ?? undefined,
        dto.forceRebuild,
      );
    } catch (error) {
      await this.persistRuntimeFailure(projectId, 'restart', commandSet, error);
      throw new BadGatewayException(
        error instanceof Error ? error.message : 'Runtime restart failed.',
      );
    }

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
            execution: execution as Prisma.InputJsonValue,
            requestedBy,
            note: dto.note,
          },
        },
      }),
    ]);

    const updatedRuntime = await this.getRuntime(projectId, ownerUserId);

    this.realtimeService.emitProjectEvent(projectId, 'runtime.updated', {
      action: 'restart',
      runtime: updatedRuntime,
    });

    return updatedRuntime;
  }

  private async persistRuntimeFailure(
    projectId: string,
    action: 'start' | 'stop' | 'restart',
    commandSet: ReturnType<RuntimeCommandFactory['build']>,
    error: unknown,
  ) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown runtime execution error.';

    const runtime = await this.prisma.sandboxRuntime.upsert({
      where: { projectId },
      create: {
        projectId,
        provider: 'DOCKER',
        status: 'FAILED',
        containerName: commandSet.containerName,
        imageTag: commandSet.imageTag,
        hostPort: commandSet.hostPort,
        previewUrl: commandSet.previewUrl,
        cpuLimit: commandSet.cpuLimit,
        memoryLimitMb: commandSet.memoryLimitMb,
        networkMode: commandSet.networkMode,
        lastCommand:
          action === 'start'
            ? commandSet.startCommand
            : action === 'stop'
              ? commandSet.stopCommand
              : `${commandSet.stopCommand} && ${commandSet.startCommand}`,
      },
      update: {
        status: 'FAILED',
        lastCommand:
          action === 'start'
            ? commandSet.startCommand
            : action === 'stop'
              ? commandSet.stopCommand
              : `${commandSet.stopCommand} && ${commandSet.startCommand}`,
      },
    });

    await this.prisma.runtimeEvent.create({
      data: {
        runtimeId: runtime.id,
        type: `${action}-failed`,
        message: `Runtime ${action} failed.`,
        payload: {
          error: message,
        },
      },
    });
  }
}
