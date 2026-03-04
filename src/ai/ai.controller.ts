import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/auth/interfaces/authenticated-user.interface';
import { AiService } from '@/ai/ai.service';
import { CreatePromptRunDto } from '@/ai/dto/create-prompt-run.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('projects/:projectId/prompts')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post()
  @ApiOperation({ summary: 'Create and enqueue an AI prompt run' })
  createPromptRun(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePromptRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.createPromptRun(projectId, dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List AI prompt runs for an owned project' })
  listPromptRuns(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.listPromptRuns(projectId, user.id);
  }

  @Patch(':promptRunId/start')
  @ApiOperation({ summary: 'Mark a prompt run as running' })
  markRunning(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiService.updatePromptStatus(
      projectId,
      promptRunId,
      'RUNNING',
      undefined,
      undefined,
      user.id,
    );
  }

  @Patch(':promptRunId/succeed')
  @ApiOperation({ summary: 'Mark a prompt run as succeeded' })
  markSucceeded(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('summary') summary?: string,
  ) {
    return this.aiService.updatePromptStatus(
      projectId,
      promptRunId,
      'SUCCEEDED',
      summary,
      undefined,
      user.id,
    );
  }

  @Patch(':promptRunId/fail')
  @ApiOperation({ summary: 'Mark a prompt run as failed' })
  markFailed(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body('summary') summary?: string,
    @Body('errorMessage') errorMessage?: string,
  ) {
    return this.aiService.updatePromptStatus(
      projectId,
      promptRunId,
      'FAILED',
      summary,
      errorMessage,
      user.id,
    );
  }
}
