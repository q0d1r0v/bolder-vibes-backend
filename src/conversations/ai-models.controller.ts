import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AVAILABLE_MODELS } from '@/config/ai.config.js';

@ApiTags('AI Models')
@Controller('ai')
export class AiModelsController {
  @Get('models')
  getModels() {
    return AVAILABLE_MODELS;
  }
}
