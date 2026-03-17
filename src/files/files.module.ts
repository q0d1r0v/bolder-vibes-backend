import { Module, forwardRef } from '@nestjs/common';
import { FilesService } from './files.service.js';
import { FilesController } from './files.controller.js';
import { VersioningService } from './versioning/versioning.service.js';
import { ProjectsModule } from '@/projects/projects.module.js';
import { GatewayModule } from '@/gateway/gateway.module.js';

@Module({
  imports: [ProjectsModule, forwardRef(() => GatewayModule)],
  controllers: [FilesController],
  providers: [FilesService, VersioningService],
  exports: [FilesService, VersioningService],
})
export class FilesModule {}
