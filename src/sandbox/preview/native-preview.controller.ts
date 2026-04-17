import { Controller, Post, Get, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NativePreviewService } from './native-preview.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser } from '@/common/decorators/index.js';

@ApiTags('Native Preview')
@ApiBearerAuth()
@Controller('projects/:projectId/native-preview')
export class NativePreviewController {
  constructor(
    private readonly nativePreviewService: NativePreviewService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('start')
  async start(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.nativePreviewService.start(projectId);
  }

  @Post('stop')
  async stop(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    await this.nativePreviewService.stop(projectId);
    return { ok: true };
  }

  @Get('status')
  async status(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.nativePreviewService.getStatus(projectId);
  }
}
