import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { getAppConfig } from '@/config/app.config';

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

export function applySecurity(
  app: INestApplication,
  config: ReturnType<typeof getAppConfig>,
) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
    next();
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const identity =
      request.ip || request.headers['x-forwarded-for'] || 'local';
    const key = Array.isArray(identity) ? identity[0] : identity;
    const bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, {
        count: 1,
        resetAt: now + config.rateLimitWindowMs,
      });
      next();
      return;
    }

    if (bucket.count >= config.rateLimitMaxRequests) {
      response.status(429).json({
        success: false,
        error: 'TooManyRequests',
        message: 'Rate limit exceeded.',
        retryAfterMs: bucket.resetAt - now,
      });
      return;
    }

    bucket.count += 1;
    next();
  });
}
