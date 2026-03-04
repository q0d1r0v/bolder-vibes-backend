import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import { CreateProjectDto } from '@/projects/dto/create-project.dto';
import { ListProjectsQueryDto } from '@/projects/dto/list-projects-query.dto';
import { UpdateProjectDto } from '@/projects/dto/update-project.dto';
import { ProjectsService } from '@/projects/projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project for the authenticated user' })
  createProject(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.createProject(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List projects owned by the authenticated user' })
  listProjects(
    @Query() query: ListProjectsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listProjects(query, user.id);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get a single owned project by id' })
  getProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.getProject(projectId, user.id);
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'Update an owned project' })
  updateProject(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateProject(projectId, dto, user.id);
  }
}
