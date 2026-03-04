import { Controller, Get } from '@nestjs/common';

import { getAppConfig } from '@/config/app.config';

@Controller('health')
export class HealthController {
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
