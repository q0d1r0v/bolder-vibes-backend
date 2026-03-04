import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateProjectDto } from '@/projects/dto/create-project.dto';
import { ListProjectsQueryDto } from '@/projects/dto/list-projects-query.dto';
import { UpdateProjectDto } from '@/projects/dto/update-project.dto';
import { ProjectsService } from '@/projects/projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(@Body() dto: CreateProjectDto) {
    return this.projectsService.createProject(dto);
  }

  @Get()
  listProjects(@Query() query: ListProjectsQueryDto) {
    return this.projectsService.listProjects(query);
  }

  @Get(':projectId')
  getProject(@Param('projectId') projectId: string) {
    return this.projectsService.getProject(projectId);
  }

  @Patch(':projectId')
  updateProject(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(projectId, dto);
  }
}
