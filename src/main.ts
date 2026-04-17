// MUST be the first import — wires up Sentry auto-instrumentation before
// any other module has a chance to load. When SENTRY_DSN is unset this
// is a no-op.
import './instrument.js';

import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import './register-paths.js';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import { createServer } from 'net';
import { AppModule } from './app.module.js';

/**
 * Check if a port is available by briefly opening a TCP server on it.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

/**
 * Starting from `preferred`, find the first free port (up to 20 attempts).
 */
async function findFreePort(preferred: number): Promise<number> {
  for (let offset = 0; offset < 20; offset++) {
    const candidate = preferred + offset;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`No free port found in range ${preferred}–${preferred + 19}`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Swap NestJS's default Logger for Pino — gives us structured JSON logs
  // + request-scoped correlation IDs automatically.
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);
  const preferredPort = configService.get<number>('app.port', 3000);
  const debug = configService.get<boolean>('app.debug', false);
  const allowedOrigins = configService.get<string[]>('cors.allowedOrigins', [
    'http://localhost:5173',
  ]);

  const isProduction = configService.get('app.nodeEnv') === 'production';

  // In production, use the configured port directly; in dev, auto-find a free port
  const port = isProduction ? preferredPort : await findFreePort(preferredPort);

  // CORS — also allow the actual port we're binding to
  const actualOrigin = `http://localhost:${port}`;
  const allOrigins = allowedOrigins.includes(actualOrigin)
    ? allowedOrigins
    : [...allowedOrigins, actualOrigin];

  // Request body size limit
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Security — configure CSP for Monaco editor (requires unsafe-eval/inline) and WebSockets.
  // Preview containers run on dynamic localhost ports, so allow iframing them
  // from any local port in both dev and production (the host is always local).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...allOrigins, 'ws:', 'wss:'],
          frameSrc: ["'self'", 'http://localhost:*', 'http://127.0.0.1:*'],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );

  app.enableCors({
    origin: allOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });

  // Swagger API documentation — disabled in production
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Bolder Vibes API')
      .setDescription('AI Vibe Coding App Builder API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Graceful shutdown hooks (Prisma, Redis cleanup)
  app.enableShutdownHooks();

  await app.listen(port);

  const logger = app.get(PinoLogger);
  if (port !== preferredPort) {
    logger.warn(
      `Port ${preferredPort} was busy — listening on port ${port} instead`,
    );
  }
  logger.log(
    `Application running on port ${port} (env=${configService.get('app.nodeEnv')}, debug=${String(debug)})`,
  );
}

void bootstrap();
