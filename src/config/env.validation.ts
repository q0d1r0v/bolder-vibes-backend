import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // App
  APP_NAME: Joi.string().default('bolder-vibes'),
  APP_PORT: Joi.number().default(3000),
  APP_DEBUG: Joi.boolean().default(false),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  // AI Providers
  OPENAI_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-4'),
  OPENAI_MAX_TOKENS: Joi.number().default(4096),
  ANTHROPIC_API_KEY: Joi.string().required(),
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-20250514'),
  ANTHROPIC_MAX_TOKENS: Joi.number().default(8192),

  // CORS
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:5173'),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),
});
