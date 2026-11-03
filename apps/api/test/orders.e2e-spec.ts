import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { withDisclosure } from '../src/agent/disclosure.js';
import { AppModule } from '../src/app.module.js';
import { encryptSecret, parseEncryptionKey } from '../src/common/encryption.js';
import type { Product, Tenant } from '../src/generated/prisma/client.js';
import { GraphClient } from '../src/messenger/graph.client.js';
import { MessengerService } from '../src/messenger/messenger.service.js';
import { signBody } from '../src/messenger/signature.js';
import { ModelService } from '../src/model/model.service.js';
import type { ChatResult } from '../src/model/model.types.js';
import { OrderService } from '../src/orders/order.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Ordering end to end against the local Postgres: the model's order tools through the
// Messenger webhook, the payment button, the checkout page and payment. Only the Graph
// API and the model are fakes. Needs `pnpm db:up` and ENCRYPTION_KEY in .env.

const APP_SECRET = 'e2e-app-secret';
const PAGE_TOKEN = 'e2e-page-token';
const PSID = 'psid-orders-1';

process.env.MESSENGER_APP_SECRET = APP_SECRET;
process.env.MESSENGER_VERIFY_TOKEN = 'e2e-verify-token';
process.env.MESSENGER_APP_ID = '424242';
process.env.PUBLIC_BASE_URL = 'https://sonor.test/';

interface GraphBody {
  recipient: { id: string };
  messaging_type?: string;
  sender_action?: string;
  message?: {
    text?: string;
    attachment?: {
      payload: {
        template_type: string;
        text: string;
        buttons: { type: string; url: string; title: string }[];
      };
    };
  };
}

const usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};
const say = (text: string): ChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop',
  usage,
  model: 'fake',
});
let callId = 0;
const call = (name: string, args: Record<string, unknown>): ChatResult => ({
  text: null,
  toolCalls: [
    {
      id: `call_${callId++}`,
      name,
      arguments: args,
      rawArguments: JSON.stringify(args),
    },
  ],
  finishReason: 'tool_calls',
  usage,
  model: 'fake',
});

describe('Orders and checkout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let messenger: MessengerService;
  let orders: OrderService;
  let tenant: Tenant;
  let hat: Product;
  const graph: GraphBody[] = [];
  const modelChat = vi.fn(() => Promise.resolve(say('OK')));
  const fakeFetch = vi.fn<typeof fetch>((_input, init) => {
    graph.push(JSON.parse(init?.body as string) as GraphBody);
    return Promise.resolve(
      new Response(JSON.stringify({ message_id: `m_${graph.length}` })),
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
    orders = app.get(OrderService);

    const suffix = Date.now().toString(36);
    tenant = await prisma.tenant.create({
      data: {
        name: 'E2E Дэлгүүр',
        slug: `e2e-orders-${suffix}`,
        businessType: 'clothing',
        facebookPageId: `e2e-orders-page-${suffix}`,
        pageAccessTokenEncrypted: encryptSecret(
          PAGE_TOKEN,
          parseEncryptionKey(process.env.ENCRYPTION_KEY),
        ),
      },
    });
    hat = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Ноолууран малгай',
        price: 59000,
        stock: 3,
        attributes: { sizes: ['нэг хэмжээ'], colors: ['саарал', 'хар'] },
      },
    });
  });

  afterAll(async () => {
    // Orders restrict customer deletion, so remove them before the tenant.
    await prisma.order.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await app.close();
  });

  beforeEach(() => {
    graph.length = 0;
    modelChat.mockReset();
    modelChat.mockResolvedValue(say('OK'));
  });

  let nextMid = 0;
  const customerSays = async (psid: string, text: string) => {
    const raw = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: tenant.facebookPageId,
          time: Date.now(),
          messaging: [
            {
              sender: { id: psid },
              recipient: { id: tenant.facebookPageId },
              timestamp: Date.now(),
              message: { mid: `mid-orders-${Date.now()}-${nextMid++}`, text },
            },
          ],
        },
      ],
    });
    const response = await request(app.getHttpServer())
      .post('/webhooks/messenger')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(raw, APP_SECRET))
      .send(raw);
    expect(response.status).toBe(200);
    await messenger.idle();
  };
  const texts = () => graph.flatMap((body) => body.message?.text ?? []);
  const buttons = () =>
    graph.flatMap((body) => body.message?.attachment?.payload ?? []);
  const openOrder = (psid: string) =>
    prisma.order.findFirstOrThrow({
      where: { tenantId: tenant.id, customer: { psid } },
      orderBy: { createdAt: 'desc' },
      include: { items: true, paymentLinks: true },
    });
  const tokenOf = (url: string) => new URL(url).pathname.split('/').pop()!;
  const checkout = (token: string) =>
    request(app.getHttpServer()).get(`/pay/${token}`);
  const pay = (token: string, form: Record<string, string>) =>
    request(app.getHttpServer()).post(`/pay/${token}`).type('form').send(form);

  it('drafts, confirms, sends a payment button and takes the demo payment', async () => {
    // Turn 1: the model drafts the order and reads the total back.
    modelChat
      .mockResolvedValueOnce(
        call('create_order', {
          items: [{ productId: hat.id, quantity: 2, color: 'har' }],
        }),
      )
      .mockResolvedValueOnce(
        say('Nooluuran malgai har 2 sh, niit 118,000₮. Batalgaajuulah uu?'),
      );
    await customerSays(PSID, 'har malgai 2-iig avya');

    const draft = await openOrder(PSID);
    expect(draft).toMatchObject({ status: 'DRAFT', total: 118000 });
    expect(draft.items).toMatchObject([
      {
        productName: 'Ноолууран малгай',
        quantity: 2,
        unitPrice: 59000,
        options: { size: 'нэг хэмжээ', color: 'хар' },
      },
    ]);
    expect(texts()).toEqual([
      withDisclosure(
        'Nooluuran malgai har 2 sh, niit 118,000₮. Batalgaajuulah uu?',
        'latin',
      ),
    ]);
    expect(buttons()).toEqual([]);

    // Turn 2: the customer agrees; Sonor sends the payment button after the reply.
    graph.length = 0;
    modelChat
      .mockResolvedValueOnce(call('confirm_order', {}))
      .mockResolvedValueOnce(say('Bayarlalaa! Tolboriin tovchiig ilgeelee.'));
    await customerSays(PSID, 'tiim');

    const confirmed = await openOrder(PSID);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(texts()).toEqual(['Bayarlalaa! Tolboriin tovchiig ilgeelee.']);
    const [button] = buttons();
    expect(button.template_type).toBe('button');
    expect(button.text).toContain('118,000₮');
    expect(button.buttons).toEqual([
      expect.objectContaining({ type: 'web_url', title: 'Tolbor toloh' }),
    ]);
    const url = button.buttons[0].url;
    expect(url).toMatch(/^https:\/\/sonor\.test\/pay\/[\w-]{24}$/);
    // The model never saw the URL.
    const toolOutputs = await prisma.message.findMany({
      where: { conversationId: confirmed.conversationId!, role: 'TOOL' },
    });
    expect(JSON.stringify(toolOutputs)).not.toContain(tokenOf(url));

    // The checkout page shows the order.
    const token = tokenOf(url);
    const page = await checkout(token);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.text).toContain('118,000₮');
    expect(page.text).toContain('Демо төлбөр');

    // Bad contact details are refused and nothing changes.
    const invalid = await pay(token, { phone: '12', address: 'x' });
    expect(invalid.status).toBe(422);
    expect((await openOrder(PSID)).status).toBe('CONFIRMED');

    // Payment: order paid, stock down, customer told in Messenger, owner alerted.
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { ownerPsid: 'psid-orders-owner' },
    });
    graph.length = 0;
    const paid = await pay(token, {
      phone: '9911 2233',
      address: 'Сүхбаатар дүүрэг, 1-р хороо',
      note: '',
    });
    expect(paid.status).toBe(200);
    expect(paid.text).toContain('Төлбөр амжилттай');
    const order = await openOrder(PSID);
    expect(order).toMatchObject({
      status: 'PAID',
      contactPhone: '99112233',
      deliveryAddress: 'Сүхбаатар дүүрэг, 1-р хороо',
      customerNote: null,
    });
    expect(order.paymentLinks[0]).toMatchObject({
      status: 'PAID',
      provider: 'DEMO',
    });
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: hat.id } })).stock,
    ).toBe(1);
    expect(graph).toHaveLength(2);
    expect(graph[0]).toMatchObject({
      recipient: { id: PSID },
      messaging_type: 'UPDATE',
    });
    expect(graph[0].message?.text).toMatch(/^Tolbor amjilttai.*118,000₮/);
    expect(graph[1]).toMatchObject({
      recipient: { id: 'psid-orders-owner' },
      messaging_type: 'UPDATE',
    });
    expect(graph[1].message?.text).toContain(
      'Ноолууран малгай (нэг хэмжээ, хар) × 2',
    );
    expect(graph[1].message?.text).toContain('Утас: 99112233');

    // A second payment is refused and stock stays put.
    const again = await pay(token, {
      phone: '99112233',
      address: 'Хаяг 12345',
    });
    expect(again.status).toBe(409);
    expect(again.text).toContain('аль хэдийн төлөгдсөн');
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: hat.id } })).stock,
    ).toBe(1);
  });

  it('asks the model to clarify instead of drafting an order it cannot price', async () => {
    modelChat
      .mockResolvedValueOnce(
        call('create_order', { items: [{ productId: hat.id, quantity: 1 }] }),
      )
      .mockResolvedValueOnce(say('Ямар өнгөтэйг авах вэ? Саарал, хар байна.'));
    await customerSays('psid-orders-2', 'малгай авъя');

    const tool = await prisma.message.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        role: 'TOOL',
        conversation: { customer: { psid: 'psid-orders-2' } },
      },
    });
    expect(tool.text).toContain('color_required');
    expect(
      await prisma.order.count({
        where: { tenantId: tenant.id, customer: { psid: 'psid-orders-2' } },
      }),
    ).toBe(0);
  });

  it('refuses payment when the item sold out after confirming, and keeps the link usable', async () => {
    const { conversationId, token } = await confirmedOrder('psid-orders-3', 1);
    await prisma.product.update({ where: { id: hat.id }, data: { stock: 0 } });

    const response = await pay(token, {
      phone: '88001122',
      address: 'Хаяг 12345',
    });
    expect(response.status).toBe(409);
    expect(response.text).toContain('бараа дууссан');
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId: tenant.id, conversationId },
      include: { paymentLinks: true },
    });
    expect(order.status).toBe('CONFIRMED');
    expect(order.paymentLinks[0].status).toBe('PENDING');
    await prisma.product.update({ where: { id: hat.id }, data: { stock: 3 } });
  });

  it('cancels the unpaid order and its payment link', async () => {
    const { conversationId, token } = await confirmedOrder('psid-orders-4', 1);

    const result = await orders.runTool(
      tenant.id,
      conversationId,
      'cancel_order',
      {},
    );
    expect(result.output).toMatchObject({ status: 'cancelled' });
    const page = await checkout(token);
    expect(page.text).toContain('Захиалга цуцлагдсан');
    expect(page.text).not.toContain('<form');
  });

  it('confirming twice sends the same link', async () => {
    const { conversationId, token } = await confirmedOrder('psid-orders-5', 1);
    const again = await orders.runTool(
      tenant.id,
      conversationId,
      'confirm_order',
      {},
    );
    expect(again.paymentLink?.url).toBe(`https://sonor.test/pay/${token}`);
  });

  it('returns 404 for unknown or malformed tokens', async () => {
    expect((await checkout('x'.repeat(24))).status).toBe(404);
    expect((await checkout('bad token!')).status).toBe(404);
    expect(
      (await pay('y'.repeat(24), { phone: '99112233', address: 'Хаяг 1' }))
        .status,
    ).toBe(404);
  });

  /** Drafts and confirms an order through the tools, as the model would. */
  async function confirmedOrder(psid: string, quantity: number) {
    const customer = await prisma.customer.create({
      data: { tenantId: tenant.id, psid },
    });
    const { id: conversationId } = await prisma.conversation.create({
      data: { tenantId: tenant.id, customerId: customer.id },
    });
    const drafted = await orders.runTool(
      tenant.id,
      conversationId,
      'create_order',
      {
        items: [{ productId: hat.id, quantity, color: 'саарал' }],
      },
    );
    expect(drafted.output).toMatchObject({ status: 'draft' });
    const confirmed = await orders.runTool(
      tenant.id,
      conversationId,
      'confirm_order',
      {},
    );
    expect(confirmed.paymentLink).toBeDefined();
    return { conversationId, token: tokenOf(confirmed.paymentLink!.url) };
  }
});
