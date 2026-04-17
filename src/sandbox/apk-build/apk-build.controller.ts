import {
  Controller,
  Post,
  Get,
  Param,
  Res,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApkBuildService } from './apk-build.service.js';
import { ProjectsService } from '@/projects/projects.service.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { StartApkBuildDto } from './dtos/start-build.dto.js';

@ApiTags('APK Build')
@ApiBearerAuth()
@Controller('projects/:projectId/apk')
export class ApkBuildController {
  constructor(
    private readonly apkBuildService: ApkBuildService,
    private readonly projectsService: ProjectsService,
  ) {}

  // APK builds are expensive — cap to 3 per minute per caller so a bug or
  // a curious user cannot queue dozens of concurrent Docker containers.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('build')
  async build(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StartApkBuildDto,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.apkBuildService.startBuild(
      projectId,
      dto.mode ?? 'local',
      dto.platform ?? 'android',
      dto.buildType ?? 'apk',
    );
  }

  @Get('status')
  async status(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.projectsService.findById(projectId, userId);
    return this.apkBuildService.getStatus(projectId);
  }

  @Get('download')
  async download(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    await this.projectsService.findById(projectId, userId);
    const { stream, sizeBytes, filename, contentType } =
      await this.apkBuildService.getApkStream(projectId);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', sizeBytes.toString());
    stream.pipe(res);
  }
}
