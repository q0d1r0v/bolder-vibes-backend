import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto, UpdateProjectDto } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';
import { PaginationDto } from '@/common/dtos/index.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser('id') userId: string,
  ) {
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
}
