import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/auth/decorators/public.decorator';
import { AppService } from '@/app.service';

@Public()
@ApiTags('meta')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Get API overview' })
  @Get()
  getOverview() {
    return this.appService.getOverview();
  }

  @ApiOperation({ summary: 'Get architecture overview' })
  @Get('architecture')
  getArchitecture() {
    return this.appService.getArchitecture();
  }
}
