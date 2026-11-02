import { Injectable } from '@nestjs/common';
import type { Conversation } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IncomingMessage } from './agent.service.js';

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

  /**
   * Saves a message the owner sent by hand and pauses the bot for this conversation.
   * Each owner message restarts the pause. Returns false if it was already saved.
   */
  async recordOwnerMessage(
    tenantId: string,
    conversationId: string,
    message: IncomingMessage,
  ): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.message.createMany({
      data: [
        {
          tenantId,
          conversationId,
          role: 'OWNER',
          text: message.text.trim() || null,
          externalId: message.externalId,
          attachments: message.attachments,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { botPaused: true, pausedAt: now, lastMessageAt: now },
    });
    return true;
  }

  /** Lets the bot answer again. Returns false if no such conversation. */
  async resume(tenantId: string, conversationId: string): Promise<boolean> {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { botPaused: false, pausedAt: null },
    });
    return count > 0;
  }
}
