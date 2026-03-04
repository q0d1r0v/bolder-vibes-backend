import 'dotenv/config';

const DEFAULT_PORT = 3000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RUNTIME_MEMORY_MB = 512;
const DEFAULT_BCRYPT_ROUNDS = 12;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000;

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
    dockerBinary: process.env.DOCKER_BINARY ?? 'docker',
    runtimeExecutionEnabled: parseBoolean(process.env.EXECUTE_DOCKER, false),
    runtimeInternalPort: parseNumber(process.env.RUNTIME_INTERNAL_PORT, 3000),
    postgresUser: process.env.POSTGRES_USER ?? 'postgres',
    postgresPassword: process.env.POSTGRES_PASSWORD ?? '3801',
    postgresDb: process.env.POSTGRES_DB ?? 'bolder_vibes_db',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    rateLimitWindowMs: parseNumber(
      process.env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    rateLimitMaxRequests: parseNumber(
      process.env.RATE_LIMIT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_MAX,
    ),
    jwtSecret: process.env.JWT_SECRET ?? 'change-me-jwt-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    bcryptRounds: parseNumber(
      process.env.AUTH_BCRYPT_ROUNDS,
      DEFAULT_BCRYPT_ROUNDS,
    ),
    aiQueueName: process.env.AI_QUEUE_NAME ?? 'ai-prompt-runs',
    aiQueueProcessInline: parseBoolean(
      process.env.AI_QUEUE_PROCESS_INLINE,
      true,
    ),
    aiAutoStartRuntime: parseBoolean(process.env.AI_AUTO_START_RUNTIME, true),
    aiDefaultProvider: process.env.AI_PROVIDER_DEFAULT ?? 'mock',
    aiRequestTimeoutMs: parseNumber(
      process.env.AI_REQUEST_TIMEOUT_MS,
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
    ),
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
    openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicBaseUrl:
      process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-3-7-sonnet-20250219',
  };
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return value === 'true';
}
