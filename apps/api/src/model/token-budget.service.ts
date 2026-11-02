import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MODEL_CONFIG, type ModelConfig } from './model.config.js';
import { ModelError } from './model.errors.js';
import type { TokenUsage } from './model.types.js';

// Daily token totals per tenant (UTC days), persisted so a restart doesn't reset them.
// The check happens before a call and usage is recorded after, so concurrent calls
// can overshoot the limit by up to one call each.
@Injectable()
export class TokenBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MODEL_CONFIG) private readonly config: ModelConfig,
  ) {}

  get dailyLimit(): number {
    return this.config.dailyTokenLimit;
  }

  async assertWithinBudget(tenantId: string, now = new Date()): Promise<void> {
    const row = await this.prisma.tokenUsage.findUnique({
      where: { tenantId_day: { tenantId, day: utcDay(now) } },
      select: { totalTokens: true },
    });
    const used = row?.totalTokens ?? 0;
    if (used >= this.dailyLimit) {
      throw new ModelError(
        'budget_exceeded',
        `Daily token limit reached for tenant ${tenantId} (${used}/${this.dailyLimit})`,
      );
    }
  }

  /** Adds a call's usage and returns the tenant's new total for today. */
  async record(
    tenantId: string,
    usage: TokenUsage,
    now = new Date(),
  ): Promise<number> {
    const day = utcDay(now);
    const row = await this.prisma.tokenUsage.upsert({
      where: { tenantId_day: { tenantId, day } },
      create: {
        tenantId,
        day,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        requests: 1,
      },
      update: {
        inputTokens: { increment: usage.inputTokens },
        outputTokens: { increment: usage.outputTokens },
        totalTokens: { increment: usage.totalTokens },
        requests: { increment: 1 },
      },
      select: { totalTokens: true },
    });
    return row.totalTokens;
  }
}

export function utcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
