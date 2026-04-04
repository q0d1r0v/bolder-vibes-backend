import { registerAs } from '@nestjs/config';

export interface AiModelConfig {
  id: string;
  name: string;
  description: string;
  maxTokens: number;
  costTier: 'low' | 'medium' | 'high';
}

export const AVAILABLE_MODELS: AiModelConfig[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Fast and capable — best for most coding tasks',
    maxTokens: 8192,
    costTier: 'medium',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Most powerful — deep reasoning and complex architecture',
    maxTokens: 8192,
    costTier: 'high',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Fastest and cheapest — quick edits and simple tasks',
    maxTokens: 4096,
    costTier: 'low',
  },
];

export default registerAs('ai', () => ({
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS!, 10) || 8192,
  },
  availableModels: AVAILABLE_MODELS,
}));
