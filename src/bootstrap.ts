import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '@/common/interceptors/response-envelope.interceptor';
import { applySecurity } from '@/common/middleware/security.middleware';
import { getAppConfig } from '@/config/app.config';

export function configureApp(app: INestApplication) {
  const config = getAppConfig();

  app.setGlobalPrefix(config.apiPrefix);
  app.enableCors({
    origin: config.corsOrigin,
    credentials: true,
  });
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();
  applySecurity(app, config);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
      forbidNonWhitelisted: true,
    }),
  );

  const logger = new Logger('Bootstrap');
  const swaggerEnabled = setupOptionalSwagger(app, logger, config);

  return {
    config,
    swaggerEnabled,
  };
}

function setupOptionalSwagger(
  app: INestApplication,
  logger: Logger,
  config: ReturnType<typeof getAppConfig>,
) {
  try {
    const documentConfig = new DocumentBuilder()
      .setTitle(config.appName)
      .setDescription(
        'AI vibe coding backend for auth, projects, files, chats, prompt runs, queues, and Docker sandbox runtime control.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('auth')
      .addTag('projects')
      .addTag('chats')
      .addTag('files')
      .addTag('ai')
      .addTag('runtime')
      .addTag('health')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document);
    return true;
  } catch {
    logger.warn(
      'Swagger skipped. Install @nestjs/swagger and swagger-ui-express to enable /api/docs.',
    );
    return false;
  }
}
