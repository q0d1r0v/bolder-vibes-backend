import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { FilesService } from '@/files/files.service';
import { ListProjectFilesQueryDto } from '@/files/dto/list-project-files-query.dto';
import { UpsertProjectFilesDto } from '@/files/dto/upsert-project-file.dto';

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  listFiles(
    @Param('projectId') projectId: string,
    @Query() query: ListProjectFilesQueryDto,
  ) {
    return this.filesService.listFiles(projectId, query);
  }

  @Post()
  saveFiles(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectFilesDto,
  ) {
    return this.filesService.saveFiles(projectId, dto);
  }
}
