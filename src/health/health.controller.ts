import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/auth/decorators/public.decorator';
import { getAppConfig } from '@/config/app.config';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  @ApiOperation({ summary: 'Get service health status' })
  @Get()
  getHealth() {
    const config = getAppConfig();

    return {
      status: 'ok',
      service: config.appName,
      environment: config.nodeEnv,
      previewBaseUrl: config.previewBaseUrl,
      databaseConnectionSkipped:
        process.env.SKIP_DB_CONNECT === 'true' ||
        process.env.NODE_ENV === 'test',
    };
  }
}
