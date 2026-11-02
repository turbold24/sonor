import type { ReasoningEffort } from './model.types.js';

export const MODEL_PROVIDERS = ['meta'] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

// Muse Spark's documented output ceiling (dev.meta.ai/docs/quickstart). The API minimum is 16.
const MAX_OUTPUT_TOKENS_CEILING = 131072;

export interface ModelConfig {
  provider: ModelProviderName;
  model: string;
  baseUrl: string;
  /** Optional at boot so the app runs without it; calls fail until it's set. */
  apiKey: string | undefined;
  /** Per HTTP attempt. */
  timeoutMs: number;
  /** Retries for 429 and 5xx only. */
  maxRetries: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  /** Tokens per tenant per UTC day. */
  dailyTokenLimit: number;
}

export const MODEL_CONFIG = Symbol('MODEL_CONFIG');

type EnvGetter = (name: string) => string | undefined;

export function loadModelConfig(get: EnvGetter): ModelConfig {
  const value = (name: string) => get(name)?.trim() || undefined;

  const provider = value('MODEL_PROVIDER') ?? 'meta';
  if (!isOneOf(MODEL_PROVIDERS, provider)) {
    throw new Error(
      `MODEL_PROVIDER must be one of: ${MODEL_PROVIDERS.join(', ')}`,
    );
  }

  const reasoningEffort = value('MODEL_REASONING_EFFORT') ?? 'low';
  if (!isOneOf(REASONING_EFFORTS, reasoningEffort)) {
    throw new Error(
      `MODEL_REASONING_EFFORT must be one of: ${REASONING_EFFORTS.join(', ')}`,
    );
  }

  return {
    provider,
    model: value('MODEL_ID') ?? 'muse-spark-1.3',
    baseUrl: value('MODEL_BASE_URL') ?? 'https://api.meta.ai/v1',
    apiKey: value('MODEL_API_KEY'),
    timeoutMs: integer(get, 'MODEL_TIMEOUT_MS', 60_000, 1_000, 600_000),
    maxRetries: integer(get, 'MODEL_MAX_RETRIES', 2, 0, 5),
    maxOutputTokens: integer(
      get,
      'MODEL_MAX_OUTPUT_TOKENS',
      4096,
      16,
      MAX_OUTPUT_TOKENS_CEILING,
    ),
    reasoningEffort,
    dailyTokenLimit: integer(
      get,
      'DAILY_TOKEN_LIMIT',
      500_000,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function integer(
  get: EnvGetter,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = get(name)?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function isOneOf<T extends string>(
  options: readonly T[],
  value: string,
): value is T {
  return (options as readonly string[]).includes(value);
}
