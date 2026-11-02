import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ModelConfig } from './model.config.js';
import { ModelError } from './model.errors.js';
import { ModelService } from './model.service.js';
import type { ChatResult, ModelProvider } from './model.types.js';
import { TokenBudgetService, utcDay } from './token-budget.service.js';

const result: ChatResult = {
  text: 'Нууц хариулт',
  toolCalls: [
    { id: 'c1', name: 'search_products', rawArguments: '{}', arguments: {} },
  ],
  finishReason: 'tool_calls',
  usage: {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 0,
    reasoningTokens: 20,
  },
  model: 'muse-spark-1.3',
};

// In-memory stand-in for the two Prisma calls the budget makes.
function fakePrisma(usedToday: number) {
  let total = usedToday;
  const tokenUsage = {
    findUnique: vi.fn(() => Promise.resolve({ totalTokens: total })),
    upsert: vi.fn(
      (args: { update: { totalTokens: { increment: number } } }) => {
        total += args.update.totalTokens.increment;
        return Promise.resolve({ totalTokens: total });
      },
    ),
  };
  return { prisma: { tokenUsage } as unknown as PrismaService, tokenUsage };
}

function setup(usedToday: number) {
  const { prisma, tokenUsage } = fakePrisma(usedToday);
  const budget = new TokenBudgetService(prisma, {
    dailyTokenLimit: 1000,
  } as ModelConfig);
  const chat = vi.fn<ModelProvider['chat']>(() => Promise.resolve(result));
  const provider: ModelProvider = {
    name: 'fake',
    model: 'muse-spark-1.3',
    chat,
  };
  return { service: new ModelService(provider, budget), chat, tokenUsage };
}

describe('ModelService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the provider and records usage for the tenant', async () => {
    const { service, chat, tokenUsage } = setup(100);

    await service.chat([{ role: 'user', content: 'Нууц асуулт' }], [], {
      tenantId: 'tenant-1',
      maxOutputTokens: 256,
    });

    expect(chat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Нууц асуулт' }],
      [],
      { maxOutputTokens: 256 },
    );
    const [upsert] = tokenUsage.upsert.mock.calls[0] as unknown as [
      { where: unknown; update: unknown },
    ];
    expect(upsert.where).toEqual({
      tenantId_day: { tenantId: 'tenant-1', day: utcDay(new Date()) },
    });
    expect(upsert.update).toMatchObject({
      totalTokens: { increment: 150 },
      requests: { increment: 1 },
    });
  });

  it('refuses calls once the daily limit is reached', async () => {
    const { service, chat } = setup(1000);

    await expect(
      service.chat([{ role: 'user', content: 'hi' }], [], {
        tenantId: 'tenant-1',
      }),
    ).rejects.toMatchObject({ kind: 'budget_exceeded' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('logs token counts but not prompts or replies', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const { service } = setup(0);

    await service.chat([{ role: 'user', content: 'Нууц асуулт' }], [], {
      tenantId: 'tenant-1',
    });

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('tenant=tenant-1');
    expect(logged).toContain('total=150');
    expect(logged).toContain('today=150/1000');
    expect(logged).not.toContain('Нууц');
  });

  it('logs failures without recording usage', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { service, chat, tokenUsage } = setup(0);
    chat.mockRejectedValueOnce(
      new ModelError('rate_limit', 'Meta Model API 429: slow down', {
        status: 429,
        code: 'rate_limit_exceeded',
      }),
    );

    await expect(
      service.chat([{ role: 'user', content: 'Нууц асуулт' }], [], {
        tenantId: 'tenant-1',
      }),
    ).rejects.toBeInstanceOf(ModelError);
    expect(tokenUsage.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain(
      'code=rate_limit_exceeded',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Нууц');
  });
});
