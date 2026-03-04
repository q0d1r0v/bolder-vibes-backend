const DEFAULT_PORT = 3000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RUNTIME_MEMORY_MB = 512;

export function getAppConfig() {
  return {
    appName: process.env.APP_NAME ?? 'Bolder Vibes API',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseNumber(process.env.PORT, DEFAULT_PORT),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    previewBaseUrl: process.env.PREVIEW_BASE_URL ?? 'http://preview.local',
    projectsRoot:
      process.env.PROJECTS_ROOT ?? '/var/lib/bolder-vibes/generated-projects',
    dockerNetwork: process.env.DOCKER_SANDBOX_NETWORK ?? 'bridge',
    runtimeCpuLimit: process.env.RUNTIME_CPU_LIMIT ?? '1',
    runtimeMemoryMb: parseNumber(
      process.env.RUNTIME_MEMORY_MB,
      DEFAULT_RUNTIME_MEMORY_MB,
    ),
    rateLimitWindowMs: parseNumber(
      process.env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    rateLimitMaxRequests: parseNumber(
      process.env.RATE_LIMIT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_MAX,
    ),
  };
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
