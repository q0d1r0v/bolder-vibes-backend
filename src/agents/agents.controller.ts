import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { PaginationDto } from '@/common/dtos/index.js';

@ApiTags('Agent Tasks')
@ApiBearerAuth()
@Controller('projects/:projectId/tasks')
export class AgentsController {
  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  async listTasks(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationDto,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.orchestrator.listTasks(projectId, pagination);
  }

  @Get(':taskId')
  async getTask(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('taskId', ParseUuidPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.orchestrator.getTaskDetail(taskId);
  }
}
