import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import { RuntimeActionDto } from '@/runtime/dto/runtime-action.dto';
import { RuntimeService } from '@/runtime/runtime.service';

@ApiTags('runtime')
@ApiBearerAuth()
@Controller('projects/:projectId/runtime')
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Get()
  @ApiOperation({ summary: 'Get runtime state for an owned project' })
  getRuntime(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runtimeService.getRuntime(projectId, user.id);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start runtime for an owned project' })
  startRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runtimeService.startRuntime(projectId, dto, user.id);
  }

  @Post('stop')
  @ApiOperation({ summary: 'Stop runtime for an owned project' })
  stopRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runtimeService.stopRuntime(projectId, dto, user.id);
  }

  @Post('restart')
  @ApiOperation({ summary: 'Restart runtime for an owned project' })
  restartRuntime(
    @Param('projectId') projectId: string,
    @Body() dto: RuntimeActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.runtimeService.restartRuntime(projectId, dto, user.id);
  }
}
