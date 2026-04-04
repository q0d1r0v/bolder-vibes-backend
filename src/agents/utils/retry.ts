import { Logger } from '@nestjs/common';

const logger = new Logger('AiRetry');

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatusCodes?: number[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

function isRetryableError(error: unknown, statusCodes: number[]): boolean {
  if (error instanceof Error) {
    const errWithStatus = error as Error & { status?: number; statusCode?: number };
    const status = errWithStatus.status ?? errWithStatus.statusCode;
    if (status && statusCodes.includes(status)) return true;

    // Network errors
    if (error.message.includes('ECONNRESET')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('ECONNREFUSED')) return true;
    if (error.message.includes('fetch failed')) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !isRetryableError(error, opts.retryableStatusCodes)) {
        throw error;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs,
      );

      logger.warn(
        `${label} attempt ${attempt + 1}/${opts.maxRetries} failed, retrying in ${delay}ms: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}
