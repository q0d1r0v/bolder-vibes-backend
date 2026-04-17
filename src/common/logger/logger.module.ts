import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

// pino spawns a worker thread for transports and resolves the `target`
// string from the worker's filesystem, which doesn't share module
// resolution with our compiled dist output. Using an absolute path
// (resolved from THIS module) side-steps the issue.
let prettyTransportTarget: string | undefined;
try {
  prettyTransportTarget = require.resolve('pino-pretty');
} catch {
  prettyTransportTarget = undefined;
}

/**
 * Structured JSON logging via Pino. Every HTTP request is tagged with a
 * correlation ID (read from `X-Request-Id` if present, otherwise minted
 * here) that flows into all logs produced during that request via Pino's
 * request-scoped child logger.
 *
 * Output is pretty-printed in development and newline-delimited JSON in
 * production so downstream aggregators (Loki, Datadog, CloudWatch) can
 * parse it without extra transforms.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('app.nodeEnv') === 'production';
        const level = config.get<string>('LOG_LEVEL') || 'info';
        return {
          pinoHttp: {
            level,
            // `genReqId` runs as the very first middleware step, before
            // the response body starts. We (ab)use it to also stamp the
            // correlation ID onto the outgoing response header so the
            // frontend (and curl) can follow a request end-to-end. Doing
            // this in `customSuccessMessage` would be too late —
            // headers are already flushed by then.
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const existing = req.headers['x-request-id'];
              const id =
                typeof existing === 'string' && existing.length > 0
                  ? existing
                  : randomUUID();
              try {
                res.setHeader('X-Request-Id', id);
              } catch {
                /* response already sent — shouldn't happen here */
              }
              return id;
            },
            customProps: () => ({ service: 'bolder-vibes-backend' }),
            customSuccessMessage: () => 'request completed',
            customErrorMessage: (_req, res, err) =>
              `request failed: ${err?.message ?? res.statusMessage ?? 'unknown'}`,
            // Redact common bearer / cookie channels so PII and secrets
            // never hit the log aggregator.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'req.body.password',
                'req.body.token',
                'req.body.accessToken',
                'req.body.refreshToken',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
            },
            transport:
              isProduction || !prettyTransportTarget
                ? undefined
                : {
                    target: prettyTransportTarget,
                    options: {
                      colorize: true,
                      singleLine: true,
                      translateTime: 'SYS:HH:MM:ss.l',
                      ignore: 'pid,hostname,req,res,responseTime,service',
                      messageFormat: '{msg} {req.method} {req.url}',
                    },
                  },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
