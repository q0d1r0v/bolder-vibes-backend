import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { TemplatesService } from './templates/templates.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, TemplatesService],
  exports: [ProjectsService, TemplatesService],
})
export class ProjectsModule {}
