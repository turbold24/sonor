import { loadModelConfig } from './model.config.js';

const from = (env: Record<string, string>) => (name: string) => env[name];

describe('loadModelConfig', () => {
  it('defaults to Muse Spark 1.3 on Meta Model API', () => {
    expect(loadModelConfig(from({}))).toEqual({
      provider: 'meta',
      model: 'muse-spark-1.3',
      baseUrl: 'https://api.meta.ai/v1',
      apiKey: undefined,
      relaySecret: undefined,
      timeoutMs: 60_000,
      maxRetries: 2,
      maxOutputTokens: 4096,
      reasoningEffort: 'low',
      dailyTokenLimit: 500_000,
    });
  });

  it('reads overrides and treats an empty key as unset', () => {
    const config = loadModelConfig(
      from({
        MODEL_ID: 'muse-spark-1.2',
        MODEL_API_KEY: '  ',
        MODEL_MAX_OUTPUT_TOKENS: '1024',
        MODEL_REASONING_EFFORT: 'medium',
        DAILY_TOKEN_LIMIT: '1000',
      }),
    );

    expect(config).toMatchObject({
      model: 'muse-spark-1.2',
      apiKey: undefined,
      maxOutputTokens: 1024,
      reasoningEffort: 'medium',
      dailyTokenLimit: 1000,
    });
  });

  it.each([
    [{ MODEL_PROVIDER: 'openai' }, /MODEL_PROVIDER/],
    [{ MODEL_REASONING_EFFORT: 'none' }, /MODEL_REASONING_EFFORT/],
    [{ MODEL_MAX_OUTPUT_TOKENS: '8' }, /MODEL_MAX_OUTPUT_TOKENS/],
    [{ MODEL_MAX_OUTPUT_TOKENS: '200000' }, /MODEL_MAX_OUTPUT_TOKENS/],
    [{ MODEL_MAX_RETRIES: 'two' }, /MODEL_MAX_RETRIES/],
    [{ DAILY_TOKEN_LIMIT: '0' }, /DAILY_TOKEN_LIMIT/],
  ])('rejects invalid values %o', (env, message) => {
    expect(() => loadModelConfig(from(env))).toThrow(message);
  });
});
