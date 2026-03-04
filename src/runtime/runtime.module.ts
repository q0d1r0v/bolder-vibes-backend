import { Module } from '@nestjs/common';

import { ProjectsModule } from '@/projects/projects.module';
import { RuntimeController } from '@/runtime/runtime.controller';
import { RuntimeCommandFactory } from '@/runtime/runtime-command.factory';
import { SandboxExecutorService } from '@/runtime/sandbox-executor.service';
import { RuntimeService } from '@/runtime/runtime.service';

@Module({
  imports: [ProjectsModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, RuntimeCommandFactory, SandboxExecutorService],
  exports: [RuntimeService],
})
export class RuntimeModule {}
