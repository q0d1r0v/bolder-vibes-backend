import { Module } from '@nestjs/common';

import { ProjectsController } from '@/projects/projects.controller';
import { ProjectsService } from '@/projects/projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
