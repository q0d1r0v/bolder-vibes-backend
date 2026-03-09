import { Module } from '@nestjs/common';
import { FilesService } from './files.service.js';
import { FilesController } from './files.controller.js';
import { VersioningService } from './versioning/versioning.service.js';
import { ProjectsModule } from '@/projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  controllers: [FilesController],
  providers: [FilesService, VersioningService],
  exports: [FilesService, VersioningService],
})
export class FilesModule {}
