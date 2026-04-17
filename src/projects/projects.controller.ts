import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto, UpdateProjectDto } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { PaginationDto } from '@/common/dtos/index.js';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser('id') userId: string) {
    return this.projectsService.create(dto, userId);
  }

  @Get()
  findAll(
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.projectsService.findAll(userId, pagination);
  }

  @Get('templates')
  getTemplates() {
    return this.projectsService.getTemplates();
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.findById(id, userId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.update(id, dto, userId);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.projectsService.remove(id, userId);
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const { archive, filename } = await this.projectsService.buildProjectZip(
      id,
      userId,
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    // Surface the filename to the browser when CORS is in play — Fetch
    // exposes only a safelist by default.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500);
      res.end(`Archive error: ${err.message}`);
    });

    archive.pipe(res);
  }
}
