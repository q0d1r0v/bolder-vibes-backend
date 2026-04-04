import { Logger } from '@nestjs/common';

const logger = new Logger('ParseAiResponse');

/**
 * Strips markdown code fences from AI responses and parses JSON.
 * AI models sometimes wrap JSON in ```json...``` blocks.
 */
export function parseAiJsonResponse<T>(
  rawContent: string,
  label: string,
): T {
  let cleaned = rawContent.trim();

  // Strip markdown code fences
  const codeFenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (codeFenceMatch) {
    cleaned = codeFenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as T;
    return parsed;
  } catch (error) {
    logger.error(
      `Failed to parse ${label} AI response as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    logger.debug(`Raw content (first 500 chars): ${rawContent.slice(0, 500)}`);
    throw new Error(
      `AI returned invalid JSON for ${label}. Please try again.`,
    );
  }
}

/**
 * Validates that a parsed object has required fields.
 */
export function validateAiOutput<T>(
  data: unknown,
  requiredFields: string[],
  label: string,
): T {
  if (!data || typeof data !== 'object') {
    throw new Error(`AI ${label} output is not an object`);
  }

  const obj = data as Record<string, unknown>;
  const missing = requiredFields.filter((field) => !(field in obj));

  if (missing.length > 0) {
    throw new Error(
      `AI ${label} output is missing required fields: ${missing.join(', ')}`,
    );
  }

  return data as T;
}
