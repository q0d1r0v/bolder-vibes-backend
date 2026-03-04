import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { AiService } from '@/ai/ai.service';
import { CreatePromptRunDto } from '@/ai/dto/create-prompt-run.dto';

@Controller('projects/:projectId/prompts')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post()
  createPromptRun(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePromptRunDto,
  ) {
    return this.aiService.createPromptRun(projectId, dto);
  }

  @Get()
  listPromptRuns(@Param('projectId') projectId: string) {
    return this.aiService.listPromptRuns(projectId);
  }

  @Patch(':promptRunId/start')
  markRunning(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
  ) {
    return this.aiService.updatePromptStatus(projectId, promptRunId, 'RUNNING');
  }

  @Patch(':promptRunId/succeed')
  markSucceeded(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
    @Body('summary') summary?: string,
  ) {
    return this.aiService.updatePromptStatus(
      projectId,
      promptRunId,
      'SUCCEEDED',
      summary,
    );
  }

  @Patch(':promptRunId/fail')
  markFailed(
    @Param('projectId') projectId: string,
    @Param('promptRunId') promptRunId: string,
    @Body('summary') summary?: string,
    @Body('errorMessage') errorMessage?: string,
  ) {
    return this.aiService.updatePromptStatus(
      projectId,
      promptRunId,
      'FAILED',
      summary,
      errorMessage,
    );
  }
}
