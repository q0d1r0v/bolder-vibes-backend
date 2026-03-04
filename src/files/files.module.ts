import { Module } from '@nestjs/common';

import { FilesController } from '@/files/files.controller';
import { FilesService } from '@/files/files.service';
import { ProjectsModule } from '@/projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
