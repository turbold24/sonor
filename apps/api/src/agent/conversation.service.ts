import { Injectable } from '@nestjs/common';
import type { Conversation } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  /** The customer's open conversation with the tenant, creating customer and conversation if needed. */
  async findOrStart(tenantId: string, psid: string): Promise<Conversation> {
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_psid: { tenantId, psid } },
      create: { tenantId, psid },
      update: {},
    });
    const open = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId: customer.id, status: 'OPEN' },
      orderBy: { lastMessageAt: 'desc' },
    });
    return (
      open ??
      this.prisma.conversation.create({
        data: { tenantId, customerId: customer.id },
      })
    );
  }
}
