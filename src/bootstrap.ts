import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';

import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '@/common/interceptors/response-envelope.interceptor';
import { applySecurity } from '@/common/middleware/security.middleware';
import { getAppConfig } from '@/config/app.config';

export function configureApp(app: INestApplication) {
  const config = getAppConfig();
  const logger = new Logger('Bootstrap');

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

  const shouldEnableValidation =
    isPackageInstalled('class-validator') &&
    isPackageInstalled('class-transformer');

  if (shouldEnableValidation) {
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidUnknownValues: false,
        forbidNonWhitelisted: true,
      }),
    );
  } else {
    logger.warn(
      'ValidationPipe skipped. Install class-validator and class-transformer to enable runtime DTO validation.',
    );
  }

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
    const dynamicRequire = eval('require') as NodeRequire;
    const swagger = dynamicRequire('@nestjs/swagger') as {
      DocumentBuilder: new () => {
        setTitle(title: string): unknown;
        setDescription(description: string): unknown;
        setVersion(version: string): unknown;
        addTag(tag: string, description?: string): unknown;
        build(): Record<string, unknown>;
      };
      SwaggerModule: {
        createDocument(
          appInstance: unknown,
          swaggerConfig: Record<string, unknown>,
        ): Record<string, unknown>;
        setup(
          path: string,
          appInstance: unknown,
          document: Record<string, unknown>,
        ): void;
      };
    };

    const DocumentBuilder = swagger.DocumentBuilder as any;
    const SwaggerModule = swagger.SwaggerModule as any;
    const documentConfig = new DocumentBuilder()
      .setTitle(config.appName)
      .setDescription(
        'AI vibe coding backend for projects, files, chats, prompt runs, and Docker sandbox runtime control.',
      )
      .setVersion('1.0.0')
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

function isPackageInstalled(packageName: string) {
  try {
    const dynamicRequire = eval('require') as NodeRequire;
    dynamicRequire.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}
