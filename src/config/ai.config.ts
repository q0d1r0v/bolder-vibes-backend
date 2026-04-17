import { registerAs } from '@nestjs/config';

export interface AiModelConfig {
  id: string;
  name: string;
  description: string;
  maxTokens: number;
  costTier: 'low' | 'medium' | 'high';
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

// `maxTokens` caps the OUTPUT per single streaming request. Fullstack
// app generation routinely produces 10+ files totalling 30-60 KB in
// one turn, which easily crosses the 8K mark and gets cut off mid-
// file. The numbers below are each model's advertised max output — we
// use them generously because short prompts never hit the cap, but
// long ones stop getting truncated.
export const AVAILABLE_MODELS: AiModelConfig[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    description: 'Fast and capable — best for most coding tasks',
    maxTokens: 64000,
    costTier: 'medium',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    description: 'Most powerful — deep reasoning and complex architecture',
    maxTokens: 32000,
    costTier: 'high',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    description: 'Fastest and cheapest — quick edits and simple tasks',
    maxTokens: 16000,
    costTier: 'low',
  },
];

export default registerAs('ai', () => ({
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL_ID,
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS!, 10) || 32000,
  },
  availableModels: AVAILABLE_MODELS,
}));
