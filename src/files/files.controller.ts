import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { FilesService } from './files.service.js';
import { CreateFileDto, UpdateFileDto } from './dtos/index.js';
import { CurrentUser } from '@/common/decorators/index.js';
import { ParseUuidPipe } from '@/common/pipes/index.js';

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  create(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Body() dto: CreateFileDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.create(projectId, dto, userId);
  }

  @Get()
  findAll(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.findAll(projectId, userId);
  }

  @Get(':fileId')
  findOne(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('fileId', ParseUuidPipe) fileId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.findById(projectId, fileId, userId);
  }

  @Patch(':fileId')
  update(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('fileId', ParseUuidPipe) fileId: string,
    @Body() dto: UpdateFileDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.update(projectId, fileId, dto, userId);
  }

  @Delete(':fileId')
  remove(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('fileId', ParseUuidPipe) fileId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.remove(projectId, fileId, userId);
  }

  @Get(':fileId/versions')
  getVersions(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('fileId', ParseUuidPipe) fileId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.getVersions(projectId, fileId, userId);
  }

  @Post(':fileId/restore/:versionId')
  restoreVersion(
    @Param('projectId', ParseUuidPipe) projectId: string,
    @Param('fileId', ParseUuidPipe) fileId: string,
    @Param('versionId', ParseUuidPipe) versionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.filesService.restoreVersion(projectId, fileId, versionId, userId);
  }
}
