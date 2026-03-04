import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import { FilesService } from '@/files/files.service';
import { ListProjectFilesQueryDto } from '@/files/dto/list-project-files-query.dto';
import { UpsertProjectFilesDto } from '@/files/dto/upsert-project-file.dto';

@ApiTags('files')
@ApiBearerAuth()
@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  @ApiOperation({ summary: 'List files for an owned project' })
  listFiles(
    @Param('projectId') projectId: string,
    @Query() query: ListProjectFilesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.filesService.listFiles(projectId, query, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Save or update files for an owned project' })
  saveFiles(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectFilesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.filesService.saveFiles(projectId, dto, user.id);
  }
}
