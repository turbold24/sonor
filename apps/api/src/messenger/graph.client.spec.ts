import { createHmac } from 'node:crypto';
import {
  GraphClient,
  GraphError,
  OWN_MESSAGE_METADATA,
} from './graph.client.js';

const TOKEN = 'EAAG-test-page-token';
const SECRET = 'app-secret';
const PSID = '2002';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function graphError(status: number, code: number, extra = {}) {
  return json(
    {
      error: {
        message: 'Something went wrong',
        type: 'OAuthException',
        code,
        fbtrace_id: 'trace123',
        ...extra,
      },
    },
    status,
  );
}

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const sleep = vi.fn(() => Promise.resolve());
  const logger = { warn: vi.fn() };
  const client = new GraphClient(
    { version: 'v26.0', appSecret: SECRET },
    { fetch, sleep, logger },
  );
  const calls = () =>
    fetch.mock.calls.map(([input, init]) => ({
      url: new URL(input instanceof Request ? input.url : input),
      method: init?.method,
      body: init?.body
        ? (JSON.parse(init.body as string) as unknown)
        : undefined,
    }));
  return { client, fetch, sleep, logger, calls };
}

describe('GraphClient', () => {
  it('sends text to /me/messages with the Page token and appsecret_proof', async () => {
    const { client, calls } = setup(
      json({ recipient_id: PSID, message_id: 'mid.1' }),
    );

    const ids = await client.sendText(TOKEN, PSID, 'Сайн байна уу!');

    expect(ids).toEqual(['mid.1']);
    const [call] = calls();
    expect(call.method).toBe('POST');
    expect(`${call.url.origin}${call.url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/me/messages',
    );
    expect(call.url.searchParams.get('access_token')).toBe(TOKEN);
    expect(call.url.searchParams.get('appsecret_proof')).toBe(
      createHmac('sha256', SECRET).update(TOKEN).digest('hex'),
    );
    expect(call.body).toEqual({
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: { text: 'Сайн байна уу!', metadata: OWN_MESSAGE_METADATA },
    });
  });

  it('sends a proactive message as UPDATE', async () => {
    const { client, calls } = setup(json({ message_id: 'mid.1' }));
    await client.sendText(TOKEN, PSID, 'Төлбөр амжилттай', 'UPDATE');
    expect(calls()[0].body).toMatchObject({ messaging_type: 'UPDATE' });
  });

  it('sends URL buttons as a button template within Meta’s limits', async () => {
    const { client, calls } = setup(json({ message_id: 'mid.1' }));

    await client.sendUrlButtons(TOKEN, PSID, 'x'.repeat(700), [
      { url: 'https://sonor.test/pay/abc', title: 'Төлбөр төлөх, одоо шууд' },
    ]);

    expect(calls()[0].body).toEqual({
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'x'.repeat(640),
            buttons: [
              {
                type: 'web_url',
                url: 'https://sonor.test/pay/abc',
                title: 'Төлбөр төлөх, одоо шууд'.slice(0, 20),
                webview_share_button: 'hide',
              },
            ],
          },
        },
        metadata: OWN_MESSAGE_METADATA,
      },
    });
  });

  it('splits replies over 2000 characters into several messages', async () => {
    const { client, calls } = setup(
      json({ message_id: 'mid.1' }),
      json({ message_id: 'mid.2' }),
    );

    const ids = await client.sendText(
      TOKEN,
      PSID,
      `${'а'.repeat(1500)}\n\n${'б'.repeat(1500)}`,
    );

    expect(ids).toEqual(['mid.1', 'mid.2']);
    const texts = calls().map(
      (call) => (call.body as { message: { text: string } }).message.text,
    );
    expect(texts.map((text) => text.length)).toEqual([1500, 1500]);
  });

  it('sends sender actions on their own', async () => {
    const { client, calls } = setup(json({ recipient_id: PSID }));

    await client.sendAction(TOKEN, PSID, 'typing_on');

    expect(calls()[0].body).toEqual({
      recipient: { id: PSID },
      sender_action: 'typing_on',
    });
  });

  it.each([
    ['a 5xx', graphError(500, 2)],
    ['a rate limit (code 613)', graphError(400, 613)],
    ['is_transient', graphError(400, 9999, { is_transient: true })],
  ])('retries once after %s', async (_case, failure) => {
    const { client, fetch, sleep } = setup(
      failure,
      json({ message_id: 'mid.1' }),
    );

    expect(await client.sendText(TOKEN, PSID, 'hi')).toEqual(['mid.1']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry', async () => {
    const { client, fetch } = setup(graphError(500, 2), graphError(500, 2));

    await expect(client.sendText(TOKEN, PSID, 'hi')).rejects.toMatchObject({
      status: 500,
      code: 2,
      fbtraceId: 'trace123',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an invalid parameter (100)', graphError(400, 100)],
    ['an expired token (190)', graphError(400, 190)],
    ['an unreachable person (551)', graphError(400, 551)],
  ])('does not retry %s', async (_case, failure) => {
    const { client, fetch } = setup(failure);

    await expect(client.sendText(TOKEN, PSID, 'hi')).rejects.toBeInstanceOf(
      GraphError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once after a network error', async () => {
    const { client, fetch } = setup(json({ message_id: 'mid.1' }));
    fetch.mockReset();
    fetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ message_id: 'mid.1' }));

    expect(await client.sendText(TOKEN, PSID, 'hi')).toEqual(['mid.1']);
  });

  it('keeps the Page token out of errors and logs', async () => {
    const { client, logger } = setup(graphError(500, 2), graphError(400, 190));

    const error = await client
      .sendText(TOKEN, PSID, 'hi')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GraphError);
    const graphErr = error as GraphError;
    expect(
      `${graphErr.message} ${graphErr.describe()} ${String(graphErr.stack)}`,
    ).not.toContain(TOKEN);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);
  });

  it('inspects a token with debug_token and subscribes the Page to webhook fields', async () => {
    const { client, calls } = setup(
      json({
        data: {
          app_id: '424242',
          type: 'PAGE',
          application: 'Sonor',
          is_valid: true,
          profile_id: '1001',
          scopes: ['pages_messaging', 'pages_manage_metadata'],
        },
      }),
      json({ success: true }),
    );

    expect(await client.tokenInfo(TOKEN)).toEqual({
      valid: true,
      type: 'PAGE',
      appId: '424242',
      profileId: '1001',
      scopes: ['pages_messaging', 'pages_manage_metadata'],
    });
    await client.subscribePage('1001', TOKEN, ['messages', 'message_echoes']);

    const [debug, subscribe] = calls();
    expect(debug.method).toBe('GET');
    expect(debug.url.pathname).toBe('/v26.0/debug_token');
    expect(debug.url.searchParams.get('input_token')).toBe(TOKEN);
    expect(debug.url.searchParams.get('access_token')).toBe(TOKEN);
    expect(debug.url.searchParams.get('appsecret_proof')).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(subscribe.method).toBe('POST');
    expect(subscribe.url.pathname).toBe('/v26.0/1001/subscribed_apps');
    expect(subscribe.url.searchParams.get('subscribed_fields')).toBe(
      'messages,message_echoes',
    );
  });

  it('reports an invalid or unexpected token without throwing', async () => {
    const { client } = setup(
      json({ data: { is_valid: false, type: 'USER', scopes: 'oops' } }),
      json({}),
    );

    expect(await client.tokenInfo(TOKEN)).toEqual({
      valid: false,
      type: 'USER',
      appId: undefined,
      profileId: undefined,
      scopes: [],
    });
    expect(await client.tokenInfo(TOKEN)).toEqual({
      valid: false,
      type: undefined,
      appId: undefined,
      profileId: undefined,
      scopes: [],
    });
  });
});
