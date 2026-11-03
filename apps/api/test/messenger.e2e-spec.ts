import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { unsupportedMediaReply } from '../src/agent/agent.prompt.js';
import { withDisclosure } from '../src/agent/disclosure.js';
import { AppModule } from '../src/app.module.js';
import { encryptSecret, parseEncryptionKey } from '../src/common/encryption.js';
import type { Tenant } from '../src/generated/prisma/client.js';
import {
  GraphClient,
  OWN_MESSAGE_METADATA,
} from '../src/messenger/graph.client.js';
import { MessengerService } from '../src/messenger/messenger.service.js';
import {
  hashLinkCode,
  linkedReply,
  resumedReply,
} from '../src/messenger/owner-messages.js';
import { signBody } from '../src/messenger/signature.js';
import { ModelService } from '../src/model/model.service.js';
import type { ChatResult } from '../src/model/model.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// The whole webhook path against the local Postgres: signature check, event parsing,
// per-customer queue, dedup, owner takeover and the agent. Only the Graph API and the
// model are fakes. Needs `pnpm db:up` and ENCRYPTION_KEY in .env.

const APP_SECRET = 'e2e-app-secret';
const VERIFY_TOKEN = 'e2e-verify-token';
const APP_ID = '424242';
const PAGE_INBOX_APP_ID = 263902037430900;
const PAGE_TOKEN = 'e2e-page-token';
const REPLY = 'Сайн байна уу! Танд юугаар туслах вэ?';
// A chat's first bot reply also says it's automated, in the customer's script.
const FIRST_LATIN = withDisclosure(REPLY, 'latin');

process.env.MESSENGER_APP_SECRET = APP_SECRET;
process.env.MESSENGER_VERIFY_TOKEN = VERIFY_TOKEN;
process.env.MESSENGER_APP_ID = APP_ID;
process.env.BOT_PAUSE_HOURS = '12';

interface GraphCall {
  url: URL;
  body: {
    recipient: { id: string };
    messaging_type?: string;
    sender_action?: string;
    message?: { text: string; metadata?: string };
  };
}

describe('Messenger webhook (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let messenger: MessengerService;
  let tenant: Tenant;
  const graphCalls: GraphCall[] = [];
  const modelChat = vi.fn((): Promise<ChatResult> =>
    Promise.resolve({
      text: REPLY,
      toolCalls: [],
      finishReason: 'stop',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      model: 'fake',
    }),
  );
  const fakeFetch = vi.fn<typeof fetch>((input, init) => {
    graphCalls.push({
      url: new URL(input instanceof Request ? input.url : input),
      body: JSON.parse(init?.body as string) as GraphCall['body'],
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          recipient_id: 'x',
          message_id: `m_${graphCalls.length}`,
        }),
      ),
    );
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GraphClient)
      .useValue(
        new GraphClient(
          { version: 'v26.0', appSecret: APP_SECRET },
          { fetch: fakeFetch, sleep: () => Promise.resolve() },
        ),
      )
      .overrideProvider(ModelService)
      .useValue({ chat: modelChat })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    messenger = app.get(MessengerService);

    const suffix = Date.now().toString(36);
    tenant = await prisma.tenant.create({
      data: {
        name: 'E2E Test Shop',
        slug: `e2e-${suffix}`,
        businessType: 'clothing',
        facebookPageId: `e2e-page-${suffix}`,
        pageAccessTokenEncrypted: encryptSecret(
          PAGE_TOKEN,
          parseEncryptionKey(process.env.ENCRYPTION_KEY),
        ),
      },
    });
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await app.close();
  });

  beforeEach(() => {
    graphCalls.length = 0;
    modelChat.mockClear();
  });

  let nextId = 0;
  const uid = (prefix: string) => `${prefix}-${Date.now()}-${nextId++}`;

  const payload = (pageId: string, ...messaging: unknown[]) => ({
    object: 'page',
    entry: [{ id: pageId, time: Date.now(), messaging }],
  });
  const fromCustomer = (psid: string, message: Record<string, unknown>) => ({
    sender: { id: psid },
    recipient: { id: tenant.facebookPageId },
    timestamp: Date.now(),
    message: { mid: uid('mid'), ...message },
  });
  const echo = (psid: string, message: Record<string, unknown>) => ({
    sender: { id: tenant.facebookPageId },
    recipient: { id: psid },
    timestamp: Date.now(),
    message: { mid: uid('mid'), is_echo: true, ...message },
  });

  const post = (
    raw: string,
    signature: string | null = signBody(raw, APP_SECRET),
  ) => {
    const req = request(app.getHttpServer())
      .post('/webhooks/messenger')
      .set('Content-Type', 'application/json');
    if (signature !== null) req.set('X-Hub-Signature-256', signature);
    return req.send(raw);
  };
  const deliver = async (body: unknown) => {
    const response = await post(JSON.stringify(body));
    expect(response.status).toBe(200);
    await messenger.idle();
  };

  const sentTexts = () =>
    graphCalls.flatMap((call) =>
      call.body.message ? [call.body.message.text] : [],
    );
  const conversationOf = (psid: string) =>
    prisma.conversation.findFirstOrThrow({
      where: { tenantId: tenant.id, customer: { psid } },
      include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });

  describe('verification handshake', () => {
    const verify = (query: Record<string, string>) =>
      request(app.getHttpServer()).get('/webhooks/messenger').query(query);

    it('returns the challenge for the right verify token', async () => {
      const response = await verify({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      });
      expect(response.status).toBe(200);
      expect(response.text).toBe('1158201444');
    });

    it.each([
      [
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': '1',
        },
      ],
      [
        {
          'hub.mode': 'unsubscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1',
        },
      ],
      [{ 'hub.mode': 'subscribe', 'hub.challenge': '1' }],
    ])('refuses %o', async (query) => {
      expect((await verify(query)).status).toBe(403);
    });
  });

  describe('signature', () => {
    it('rejects a missing, wrong or stale signature and processes nothing', async () => {
      const psid = uid('psid');
      const raw = JSON.stringify(
        payload(tenant.facebookPageId, fromCustomer(psid, { text: 'hi' })),
      );

      expect((await post(raw, null)).status).toBe(403);
      expect((await post(raw, signBody(raw, 'other-secret'))).status).toBe(403);
      const tampered = raw.replace('hi', 'hello');
      expect((await post(tampered, signBody(raw, APP_SECRET))).status).toBe(
        403,
      );
      await messenger.idle();

      expect(graphCalls).toEqual([]);
      expect(await prisma.customer.count({ where: { psid } })).toBe(0);
    });

    it('accepts a valid signature over Meta-style escaped Unicode', async () => {
      const psid = uid('psid');
      const raw = JSON.stringify(
        payload(tenant.facebookPageId, fromCustomer(psid, { text: 'Сайн уу' })),
      ).replace(
        /[^ -~]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );
      // Only printable ASCII is left after escaping.
      expect(raw).toMatch(/^[ -~]*$/);

      const response = await post(raw);
      await messenger.idle();

      expect(response.status).toBe(200);
      expect(response.text).toBe('EVENT_RECEIVED');
      const conversation = await conversationOf(psid);
      expect(conversation.messages[0]).toMatchObject({
        role: 'CUSTOMER',
        text: 'Сайн уу',
      });
    });
  });

  it('answers a text message: mark_seen, typing_on, then the reply', async () => {
    const psid = uid('psid');

    await deliver(
      payload(
        tenant.facebookPageId,
        fromCustomer(psid, { text: 'deel bga yu?' }),
      ),
    );

    expect(modelChat).toHaveBeenCalledTimes(1);
    expect(
      graphCalls.map((call) => call.body.sender_action ?? 'message'),
    ).toEqual(['mark_seen', 'typing_on', 'message']);
    const [, , send] = graphCalls;
    expect(send.body).toEqual({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text: FIRST_LATIN, metadata: OWN_MESSAGE_METADATA },
    });
    expect(send.url.searchParams.get('access_token')).toBe(PAGE_TOKEN);
    expect(send.url.searchParams.get('appsecret_proof')).toBeTruthy();

    const { messages } = await conversationOf(psid);
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['CUSTOMER', 'deel bga yu?'],
      ['AGENT', FIRST_LATIN],
    ]);
  });

  it('ignores a retried delivery of the same message', async () => {
    const psid = uid('psid');
    const body = payload(
      tenant.facebookPageId,
      fromCustomer(psid, { text: 'hi' }),
    );

    await deliver(body);
    await deliver(body);

    expect(modelChat).toHaveBeenCalledTimes(1);
    expect(sentTexts()).toEqual([FIRST_LATIN]);
    const { messages } = await conversationOf(psid);
    expect(messages.filter((m) => m.role === 'CUSTOMER')).toHaveLength(1);
  });

  it("answers one customer's messages in order", async () => {
    const psid = uid('psid');
    const base = await modelChat();
    modelChat.mockClear();
    modelChat
      .mockResolvedValueOnce({ ...base, text: 'Эхний хариу.' })
      .mockResolvedValueOnce({ ...base, text: 'Хоёр дахь хариу.' });

    await deliver(
      payload(
        tenant.facebookPageId,
        fromCustomer(psid, { text: 'first' }),
        fromCustomer(psid, { text: 'second' }),
      ),
    );

    // Only the first reply carries the disclosure.
    expect(sentTexts()).toEqual([
      withDisclosure('Эхний хариу.', 'latin'),
      'Хоёр дахь хариу.',
    ]);
  });

  it('pauses the bot when the owner replies from the Page inbox', async () => {
    const psid = uid('psid');
    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'hi' })),
    );
    graphCalls.length = 0;
    modelChat.mockClear();

    await deliver(
      payload(
        tenant.facebookPageId,
        echo(psid, {
          text: 'Сайн байна уу, би менежер.',
          app_id: PAGE_INBOX_APP_ID,
        }),
      ),
    );
    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'Баярлалаа' })),
    );

    const conversation = await conversationOf(psid);
    expect(conversation.botPaused).toBe(true);
    expect(
      conversation.messages.slice(-2).map((m) => [m.role, m.text]),
    ).toEqual([
      ['OWNER', 'Сайн байна уу, би менежер.'],
      ['CUSTOMER', 'Баярлалаа'],
    ]);
    expect(modelChat).not.toHaveBeenCalled();
    expect(graphCalls).toEqual([]);
  });

  it('says it is automated again when the bot takes over from the owner', async () => {
    const psid = uid('psid');
    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'hi' })),
    );
    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'hi again' })),
    );
    await deliver(
      payload(
        tenant.facebookPageId,
        echo(psid, { text: 'Би менежер.', app_id: PAGE_INBOX_APP_ID }),
      ),
    );
    const { id } = await conversationOf(psid);
    await prisma.conversation.update({
      where: { id },
      data: { botPaused: false, pausedAt: null },
    });
    graphCalls.length = 0;

    await deliver(
      payload(
        tenant.facebookPageId,
        fromCustomer(psid, { text: 'bas neg asuult' }),
      ),
    );

    expect(sentTexts()).toEqual([FIRST_LATIN]);
  });

  it("ignores echoes of Sonor's own replies", async () => {
    const psid = uid('psid');

    await deliver(
      payload(
        tenant.facebookPageId,
        fromCustomer(psid, { text: 'hi' }),
        echo(psid, {
          text: REPLY,
          metadata: OWN_MESSAGE_METADATA,
          app_id: Number(APP_ID),
        }),
        echo(psid, { text: REPLY, app_id: Number(APP_ID) }),
      ),
    );

    const conversation = await conversationOf(psid);
    expect(conversation.botPaused).toBe(false);
    expect(conversation.messages.some((m) => m.role === 'OWNER')).toBe(false);
  });

  it('resumes on its own after BOT_PAUSE_HOURS', async () => {
    const psid = uid('psid');
    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'hi' })),
    );
    const { id } = await conversationOf(psid);
    await prisma.conversation.update({
      where: { id },
      data: {
        botPaused: true,
        pausedAt: new Date(Date.now() - 13 * 3_600_000),
      },
    });
    graphCalls.length = 0;

    await deliver(
      payload(tenant.facebookPageId, fromCustomer(psid, { text: 'Сайн уу?' })),
    );

    expect(sentTexts()).toEqual([REPLY]);
    expect((await conversationOf(psid)).botPaused).toBe(false);
  });

  it('answers attachments with a text-only note and keeps the attachment', async () => {
    const psid = uid('psid');
    const attachment = {
      type: 'image',
      payload: { url: 'https://example.test/deel.jpg' },
    };

    await deliver(
      payload(
        tenant.facebookPageId,
        fromCustomer(psid, { attachments: [attachment] }),
      ),
    );

    expect(modelChat).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual([
      withDisclosure(unsupportedMediaReply(), 'cyrillic'),
    ]);
    const { messages } = await conversationOf(psid);
    expect(messages[0]).toMatchObject({
      role: 'CUSTOMER',
      text: null,
      attachments: [attachment],
    });
  });

  it('ignores events for Pages that belong to no tenant', async () => {
    const psid = uid('psid');

    await deliver(payload('no-such-page', fromCustomer(psid, { text: 'hi' })));

    expect(graphCalls).toEqual([]);
    expect(await prisma.customer.count({ where: { psid } })).toBe(0);
  });

  describe('owner', () => {
    const OWNER = 'psid-owner';
    const CODE = 'SONOR-K3F9Q2';
    const sentTo = (psid: string) =>
      graphCalls.flatMap((call) =>
        call.body.recipient.id === psid && call.body.message
          ? [call.body.message.text]
          : [],
      );
    const ownerOf = async () =>
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }))
        .ownerPsid;

    afterAll(() =>
      prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          ownerPsid: null,
          ownerLinkCodeHash: null,
          ownerLinkExpiresAt: null,
        },
      }),
    );

    it('links the owner with a one-time code and refuses it afterwards', async () => {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          ownerLinkCodeHash: hashLinkCode(CODE),
          ownerLinkExpiresAt: new Date(Date.now() + 60_000),
        },
      });

      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer(OWNER, { text: ' sonor-k3f9q2 ' }),
        ),
      );

      expect(await ownerOf()).toBe(OWNER);
      expect(sentTo(OWNER)).toEqual([linkedReply(tenant.name)]);
      expect(modelChat).not.toHaveBeenCalled();
      expect(await prisma.customer.count({ where: { psid: OWNER } })).toBe(0);

      graphCalls.length = 0;
      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer('psid-intruder', { text: CODE }),
        ),
      );
      expect(await ownerOf()).toBe(OWNER);
      expect(sentTo('psid-intruder')[0]).toContain('буруу');
    });

    it('alerts the owner when the bot hands a chat over, and /resume turns it back on', async () => {
      const psid = uid('psid');
      modelChat
        .mockResolvedValueOnce({
          text: null,
          toolCalls: [
            {
              id: 'call_handoff',
              name: 'request_handoff',
              arguments: { reason: 'Asks about delivery' },
              rawArguments: '{"reason":"Asks about delivery"}',
            },
          ],
          finishReason: 'tool_calls',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
          model: 'fake',
        })
        .mockResolvedValueOnce({
          text: 'Манай менежер удахгүй хариулна.',
          toolCalls: [],
          finishReason: 'stop',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
          model: 'fake',
        });

      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer(psid, { text: 'hurgelt hed honog ve?' }),
        ),
      );

      const conversation = await conversationOf(psid);
      const code = conversation.id.slice(-6).toUpperCase();
      expect(conversation.botPaused).toBe(true);
      expect(sentTo(psid)).toEqual([
        withDisclosure('Манай менежер удахгүй хариулна.', 'latin'),
      ]);
      const alerts = graphCalls.filter(
        (call) => call.body.recipient.id === OWNER,
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0].body.messaging_type).toBe('UPDATE');
      const alert = alerts[0].body.message?.text ?? '';
      expect(alert).toContain(`чат #${code}`);
      expect(alert).toContain('Шалтгаан: Asks about delivery');
      expect(alert).toContain('"hurgelt hed honog ve?"');

      graphCalls.length = 0;
      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer(OWNER, { text: `/resume ${code.toLowerCase()}` }),
        ),
      );
      expect((await conversationOf(psid)).botPaused).toBe(false);
      expect(sentTo(OWNER)).toEqual([resumedReply(code, true)]);
    });

    it("answers the owner's ordinary messages like a customer's", async () => {
      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer(OWNER, { text: 'deel bga yu?' }),
        ),
      );
      expect(modelChat).toHaveBeenCalled();
      expect(sentTo(OWNER)).toEqual([FIRST_LATIN]);
    });

    it('treats commands from anyone else as ordinary messages', async () => {
      const psid = uid('psid');
      await deliver(
        payload(
          tenant.facebookPageId,
          fromCustomer(psid, { text: '/resume ABC123' }),
        ),
      );
      expect(modelChat).toHaveBeenCalled();
      expect(sentTo(psid)).toEqual([FIRST_LATIN]);
    });
  });
});
