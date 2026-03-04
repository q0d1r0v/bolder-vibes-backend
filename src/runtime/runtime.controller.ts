import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { RuntimeActionDto } from '@/runtime/dto/runtime-action.dto';
import { RuntimeService } from '@/runtime/runtime.service';

@Controller('projects/:projectId/runtime')
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Get()
  getRuntime(@Param('projectId') projectId: string) {
    return this.runtimeService.getRuntime(projectId);
  }

  @Post('start')
  startRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
  ) {
    return this.runtimeService.startRuntime(projectId, dto);
  }

  @Post('stop')
  stopRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
  ) {
    return this.runtimeService.stopRuntime(projectId, dto);
  }

  @Post('restart')
  restartRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
  ) {
    return this.runtimeService.restartRuntime(projectId, dto);
  }
}
