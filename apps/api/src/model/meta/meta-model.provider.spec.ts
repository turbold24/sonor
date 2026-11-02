import type { ModelConfig } from '../model.config.js';
import { ModelError } from '../model.errors.js';
import { MetaModelProvider } from './meta-model.provider.js';

const API_KEY = 'LLM_123_test-secret';

const config: ModelConfig = {
  provider: 'meta',
  model: 'muse-spark-1.3',
  baseUrl: 'https://api.meta.ai/v1/',
  apiKey: API_KEY,
  timeoutMs: 1_000,
  maxRetries: 2,
  maxOutputTokens: 2048,
  reasoningEffort: 'low',
  dailyTokenLimit: 1_000_000,
};

const okBody = {
  status: 'completed',
  model: 'muse-spark-1.3',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Сайн байна уу!' }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function apiError(status: number, type: string, code: string | null) {
  return { error: { message: `${type} happened`, type, param: null, code } };
}

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const sleep = vi.fn((_ms: number) => Promise.resolve());
  const logger = { warn: vi.fn() };
  const provider = new MetaModelProvider(config, {
    fetch,
    sleep,
    random: () => 0,
    logger,
  });
  return { provider, fetch, sleep, logger };
}

const user = [{ role: 'user' as const, content: 'Сайн уу' }];

describe('MetaModelProvider', () => {
  it('posts to /v1/responses with bearer auth and maps the reply', async () => {
    const { provider, fetch } = setup(jsonResponse(200, okBody));

    const result = await provider.chat(user, [], { maxOutputTokens: 512 });

    expect(result.text).toBe('Сайн байна уу!');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.meta.ai/v1/responses');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'muse-spark-1.3',
      max_output_tokens: 512,
      reasoning: { effort: 'low' },
      store: false,
    });
  });

  it('never raises max output tokens above the configured limit', async () => {
    const { provider, fetch } = setup(jsonResponse(200, okBody));

    await provider.chat(user, [], { maxOutputTokens: 100_000 });

    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string) as {
      max_output_tokens: number;
    };
    expect(body.max_output_tokens).toBe(2048);
  });

  it('retries 429 and 5xx with backoff, honoring Retry-After', async () => {
    const { provider, fetch, sleep } = setup(
      jsonResponse(
        429,
        apiError(429, 'rate_limit_error', 'rate_limit_exceeded'),
        {
          'Retry-After': '2',
        },
      ),
      jsonResponse(500, apiError(500, 'server_error', null)),
      jsonResponse(200, okBody),
    );

    const result = await provider.chat(user, []);

    expect(result.text).toBe('Сайн байна уу!');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 1000]);
  });

  it('gives up after maxRetries', async () => {
    const overloaded = () =>
      jsonResponse(503, apiError(503, 'server_error', 'backend_unavailable'));
    const { provider, fetch } = setup(overloaded(), overloaded(), overloaded());

    await expect(provider.chat(user, [])).rejects.toMatchObject({
      kind: 'server',
      details: { status: 503, code: 'backend_unavailable' },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not wait out a Retry-After longer than the cap', async () => {
    const { provider, fetch, sleep } = setup(
      jsonResponse(503, apiError(503, 'server_error', 'service_overloaded'), {
        'Retry-After': '60',
      }),
    );

    await expect(provider.chat(user, [])).rejects.toBeInstanceOf(ModelError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'invalid_request_error', null, 'bad_request'],
    [401, 'authentication_error', 'invalid_api_key', 'auth'],
    [402, 'billing_error', 'billing_not_configured', 'billing'],
    [504, 'server_error', 'gateway_timeout', 'server'],
  ])('does not retry %i', async (status, type, code, kind) => {
    const { provider, fetch } = setup(
      jsonResponse(status, apiError(status, type, code)),
    );

    await expect(provider.chat(user, [])).rejects.toMatchObject({
      kind,
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handles a 404 with an empty body', async () => {
    const { provider } = setup(new Response('', { status: 404 }));

    await expect(provider.chat(user, [])).rejects.toMatchObject({
      kind: 'bad_request',
      message: 'Meta Model API 404: HTTP 404',
    });
  });

  it('times out a hanging request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'TimeoutError')),
          );
        }),
    );
    const provider = new MetaModelProvider(
      { ...config, timeoutMs: 20 },
      { fetch, sleep: () => Promise.resolve() },
    );

    await expect(provider.chat(user, [])).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast without an API key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new MetaModelProvider(
      { ...config, apiKey: undefined },
      { fetch },
    );

    await expect(provider.chat(user, [])).rejects.toMatchObject({
      kind: 'config',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the API key out of errors and retry logs', async () => {
    const { provider, logger } = setup(
      jsonResponse(500, apiError(500, 'server_error', null)),
      jsonResponse(
        401,
        apiError(401, 'authentication_error', 'invalid_api_key'),
      ),
    );

    const error = await provider.chat(user, []).catch((e: unknown) => e);

    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(String(error)).not.toContain(API_KEY);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(API_KEY);
  });
});
