import { Module } from '@nestjs/common';
import { DeployController } from './deploy.controller.js';
import { DeployService } from './deploy.service.js';
import { PrismaModule } from '@/prisma/prisma.module.js';
import { ProjectsModule } from '@/projects/projects.module.js';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [DeployController],
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
