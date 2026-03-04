import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const { config, swaggerEnabled } = configureApp(app);

  await app.listen(config.port);
  logger.log(
    `API ready on http://localhost:${config.port}/${config.apiPrefix} (${swaggerEnabled ? 'Swagger enabled' : 'Swagger skipped'})`,
  );
}

void bootstrap();
