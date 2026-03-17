import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SandboxService } from './sandbox.service.js';
import { ExecuteCommandDto } from './dtos/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ProjectsService } from '@/projects/projects.service.js';

@ApiTags('Sandbox')
@ApiBearerAuth()
@Controller('projects/:projectId/sandbox')
export class SandboxController {
  constructor(
    private readonly sandboxService: SandboxService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('execute')
  async execute(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ExecuteCommandDto,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.sandboxService.executeCommand(projectId, dto.command, {
      timeoutMs: dto.timeoutMs,
      maxMemoryMb: dto.maxMemoryMb,
      networkEnabled: dto.networkEnabled,
    });
  }

  @Post('preview/start')
  async startPreview(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.sandboxService.startPreview(projectId);
  }

  @Get('preview/status')
  async getPreviewStatus(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.sandboxService.getPreviewStatus(projectId);
  }

  @Post('preview/stop')
  async stopPreview(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.sandboxService.stopPreview(projectId);
  }
}
