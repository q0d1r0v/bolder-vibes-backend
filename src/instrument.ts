/**
 * Sentry bootstrap. Imported at the very top of main.ts (and ONLY there)
 * so instrumentation runs before any other module loads — this is what
 * lets Sentry auto-patch the HTTP, Postgres and Redis clients.
 *
 * Sentry stays completely inert when SENTRY_DSN is unset, so development
 * and CI environments need no extra configuration.
 */
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;
if (dsn && dsn.length > 0) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Capture 10% of transactions + 10% of profiles in production; 100% in
    // dev so the developer sees traces while working on instrumentation.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [nodeProfilingIntegration()],
    // Filter out predictable 4xx noise — only 5xx and unexpected exceptions
    // should pollute the alert stream.
    beforeSend(event, hint) {
      const err = hint.originalException as { status?: number } | undefined;
      if (err?.status && err.status < 500) return null;
      return event;
    },
  });
}
