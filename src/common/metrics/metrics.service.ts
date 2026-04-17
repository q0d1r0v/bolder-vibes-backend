import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  register,
} from 'prom-client';

/**
 * Application-level metrics exposed at GET /metrics. Consumers: Prometheus,
 * Grafana Agent, anything scraping the standard text exposition format.
 *
 * Counters / histograms are registered on the default prom-client registry
 * so `register.metrics()` returns everything — including process-level
 * defaults (GC, heap, event loop lag).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly apkBuildsStarted = new Counter({
    name: 'bv_apk_builds_started_total',
    help: 'Total APK builds started, labelled by mode and build type.',
    labelNames: ['mode', 'build_type', 'platform'] as const,
  });

  readonly apkBuildsSucceeded = new Counter({
    name: 'bv_apk_builds_succeeded_total',
    help: 'Total APK builds that completed successfully.',
    labelNames: ['mode', 'build_type', 'platform'] as const,
  });

  readonly apkBuildsFailed = new Counter({
    name: 'bv_apk_builds_failed_total',
    help: 'Total APK builds that ended with an error.',
    labelNames: ['mode', 'build_type', 'platform', 'reason'] as const,
  });

  readonly apkBuildDurationSeconds = new Histogram({
    name: 'bv_apk_build_duration_seconds',
    help: 'Wall-clock duration of APK builds, from start to success/failure.',
    labelNames: ['mode', 'build_type', 'platform', 'outcome'] as const,
    // Cover the realistic range: a warm local build (~3 min) up to an
    // unusually-long cold EAS cloud build (~40 min).
    buckets: [30, 60, 120, 300, 600, 900, 1200, 1800, 2400, 3000],
  });

  readonly previewStarts = new Counter({
    name: 'bv_preview_starts_total',
    help: 'Total number of preview container starts.',
    labelNames: ['kind'] as const,
  });

  onModuleInit(): void {
    // Register Node.js process defaults (heap, gc, event loop) once.
    collectDefaultMetrics({ prefix: 'bv_' });
  }

  /** Renders the Prometheus text format for the default registry. */
  render(): Promise<string> {
    return register.metrics();
  }

  contentType(): string {
    return register.contentType;
  }
}
