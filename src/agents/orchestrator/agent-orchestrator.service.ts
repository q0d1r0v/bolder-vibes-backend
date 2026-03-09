import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service.js';
import { RedisService } from '@/redis/redis.service.js';
import { FilesService } from '@/files/files.service.js';
import { VersioningService } from '@/files/versioning/versioning.service.js';
import { PlannerAgentService } from '../planner/planner-agent.service.js';
import { DeveloperAgentService } from '../developer/developer-agent.service.js';
import { RefactorAgentService } from '../refactor/refactor-agent.service.js';
import type { FileChange } from '../developer/developer.interface.js';
import type { PipelineResult } from './pipeline.interface.js';
import { AgentTaskStatus } from '@/common/enums/index.js';

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly filesService: FilesService,
    private readonly versioningService: VersioningService,
    private readonly plannerAgent: PlannerAgentService,
    private readonly developerAgent: DeveloperAgentService,
    private readonly refactorAgent: RefactorAgentService,
  ) { }

  async executeTask(
    projectId: string,
    conversationId: string,
    userPrompt: string,
    userId: string,
  ): Promise<PipelineResult> {
    // Create agent task
    const task = await this.prisma.agentTask.create({
      data: {
        prompt: userPrompt,
        projectId,
        conversationId,
        status: 'PENDING',
      },
    });

    try {
      // Get project file tree
      const files = await this.prisma.projectFile.findMany({
        where: { projectId },
        select: { path: true, content: true },
      });
      const fileTree = files.map((f) => f.path);

      // Get conversation context
      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { role: true, content: true },
      });
      const conversationContext = messages
        .reverse()
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      // Check cancellation
      if (await this.isCancelled(task.id)) {
        return this.cancelTask(task.id);
      }

      // ─── Step 1: PLANNER ─────────────────────────
      await this.updateTaskStatus(task.id, 'PLANNING');
      const planStep = await this.prisma.agentStep.create({
        data: {
          taskId: task.id,
          agentType: 'PLANNER',
          stepOrder: 1,
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      const startPlan = Date.now();
      const { plan, tokenUsage: planTokens } =
        await this.plannerAgent.createPlan(
          userPrompt,
          fileTree,
          conversationContext,
        );

      await this.prisma.agentStep.update({
        where: { id: planStep.id },
        data: {
          status: 'COMPLETED',
          output: plan as any,
          tokenUsage: planTokens,
          durationMs: Date.now() - startPlan,
          completedAt: new Date(),
        },
      });

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: { plan: plan as any },
      });

      // Check cancellation
      if (await this.isCancelled(task.id)) {
        return this.cancelTask(task.id);
      }

      // ─── Step 2: DEVELOPER ───────────────────────
      await this.updateTaskStatus(task.id, 'DEVELOPING');
      const devStep = await this.prisma.agentStep.create({
        data: {
          taskId: task.id,
          agentType: 'DEVELOPER',
          stepOrder: 2,
          status: 'RUNNING',
          startedAt: new Date(),
          input: plan as any,
        },
      });

      // Get contents of files mentioned in plan
      const affectedPaths = plan.steps.map((s) => s.filePath);
      const fileContents = files
        .filter((f) => affectedPaths.includes(f.path))
        .map((f) => ({ path: f.path, content: f.content }));

      const startDev = Date.now();
      const { output: devOutput, tokenUsage: devTokens } =
        await this.developerAgent.generateCode(plan, fileContents, '');

      await this.prisma.agentStep.update({
        where: { id: devStep.id },
        data: {
          status: 'COMPLETED',
          output: devOutput as any,
          tokenUsage: devTokens,
          durationMs: Date.now() - startDev,
          completedAt: new Date(),
        },
      });

      // Check cancellation
      if (await this.isCancelled(task.id)) {
        return this.cancelTask(task.id);
      }

      // ─── Step 3: REFACTOR ────────────────────────
      await this.updateTaskStatus(task.id, 'REFACTORING');
      const refactorStep = await this.prisma.agentStep.create({
        data: {
          taskId: task.id,
          agentType: 'REFACTOR',
          stepOrder: 3,
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });

      const startRefactor = Date.now();
      const { output: refactorOutput, tokenUsage: refactorTokens } =
        await this.refactorAgent.reviewAndRefactor(plan, devOutput);

      await this.prisma.agentStep.update({
        where: { id: refactorStep.id },
        data: {
          status: 'COMPLETED',
          output: refactorOutput as any,
          tokenUsage: refactorTokens,
          durationMs: Date.now() - startRefactor,
          completedAt: new Date(),
        },
      });

      // ─── Apply Changes ───────────────────────────
      const finalChanges =
        refactorOutput.changes.length > 0
          ? refactorOutput.changes
          : devOutput.changes;

      const appliedStepId =
        refactorOutput.changes.length > 0
          ? refactorStep.id
          : devStep.id;

      await this.applyFileChanges(
        projectId,
        finalChanges,
        appliedStepId,
      );

      // Complete task
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: 'COMPLETED',
          result: {
            summary: refactorOutput.summary || devOutput.summary,
            filesChanged: finalChanges.length,
            qualityReport: refactorOutput.qualityReport,
          },
          completedAt: new Date(),
        },
      });

      // Add assistant message
      await this.prisma.message.create({
        data: {
          role: 'ASSISTANT',
          content:
            refactorOutput.summary || devOutput.summary || 'Changes applied.',
          conversationId,
          agentTaskId: task.id,
        },
      });

      return {
        taskId: task.id,
        status: AgentTaskStatus.COMPLETED,
        summary: refactorOutput.summary || devOutput.summary,
        filesChanged: finalChanges.length,
      };
    } catch (error) {
      this.logger.error(`Pipeline failed for task ${task.id}`, error);

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
      });

      return {
        taskId: task.id,
        status: AgentTaskStatus.FAILED,
        summary:
          error instanceof Error ? error.message : 'Pipeline failed',
        filesChanged: 0,
      };
    }
  }

  async cancelTask(taskId: string): Promise<PipelineResult> {
    await this.prisma.agentTask.update({
      where: { id: taskId },
      data: { status: 'CANCELLED' },
    });

    // Mark pending steps as skipped
    await this.prisma.agentStep.updateMany({
      where: { taskId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'SKIPPED' },
    });

    return {
      taskId,
      status: AgentTaskStatus.CANCELLED,
      summary: 'Task cancelled by user',
      filesChanged: 0,
    };
  }

  async requestCancellation(taskId: string) {
    await this.redis.set(`task:cancel:${taskId}`, '1', 'EX', 300);
  }

  async getTaskDetail(taskId: string) {
    return this.prisma.agentTask.findUnique({
      where: { id: taskId },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    });
  }

  private async isCancelled(taskId: string): Promise<boolean> {
    const cancelled = await this.redis.get(`task:cancel:${taskId}`);
    return cancelled === '1';
  }

  private async updateTaskStatus(taskId: string, status: string) {
    await this.prisma.agentTask.update({
      where: { id: taskId },
      data: { status: status as any },
    });
  }

  private async applyFileChanges(
    projectId: string,
    changes: FileChange[],
    agentStepId: string,
  ) {
    for (const change of changes) {
      switch (change.operation) {
        case 'create': {
          const file = await this.prisma.projectFile.create({
            data: {
              path: change.filePath,
              content: change.content || '',
              size: Buffer.byteLength(change.content || '', 'utf8'),
              projectId,
            },
          });
          await this.versioningService.createVersion(
            file.id,
            change.content || '',
            null,
            change.filePath,
            'Created by AI agent',
            agentStepId,
          );
          break;
        }
        case 'update': {
          const existing = await this.prisma.projectFile.findFirst({
            where: { projectId, path: change.filePath },
          });
          if (existing) {
            const oldContent = existing.content;
            await this.prisma.projectFile.update({
              where: { id: existing.id },
              data: {
                content: change.content || '',
                size: Buffer.byteLength(change.content || '', 'utf8'),
              },
            });
            await this.versioningService.createVersion(
              existing.id,
              change.content || '',
              oldContent,
              change.filePath,
              'Updated by AI agent',
              agentStepId,
            );
          }
          break;
        }
        case 'delete': {
          const toDelete = await this.prisma.projectFile.findFirst({
            where: { projectId, path: change.filePath },
          });
          if (toDelete) {
            await this.prisma.projectFile.delete({
              where: { id: toDelete.id },
            });
          }
          break;
        }
      }
    }
  }
}
