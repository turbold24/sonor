import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from '../agent/conversation.service.js';
import { decryptSecret, parseEncryptionKey } from '../common/encryption.js';
import type { Tenant } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GraphClient, GraphError, type MessagingType } from './graph.client.js';
import {
  chatCode,
  handoffAlert,
  hashLinkCode,
  helpReply,
  linkCodeIn,
  linkedReply,
  paidOrderAlert,
  parseOwnerCommand,
  resumedReply,
  type PaidOrderAlert,
} from './owner-messages.js';

const DEFAULT_PAUSE_HOURS = 12;
const INVALID_CODE_REPLY = 'Энэ код буруу эсвэл хугацаа нь дууссан байна.';

/**
 * The shop owner on Messenger: linking their personal account with a one-time code,
 * their "/" commands, and alerts about handoffs and paid orders. Messenger only allows
 * these within 24 hours of the owner's last message to the Page.
 */
@Injectable()
export class OwnerService {
  private readonly logger = new Logger(OwnerService.name);
  private readonly pauseHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphClient,
    private readonly conversations: ConversationService,
    private readonly config: ConfigService,
  ) {
    const hours = Number(config.get<string>('BOT_PAUSE_HOURS'));
    this.pauseHours =
      Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_PAUSE_HOURS;
  }

  /**
   * Handles a message that is an owner link code, from anyone: a valid, unexpired code
   * makes the sender the tenant's owner. Returns false for any other message.
   */
  async tryLink(tenant: Tenant, psid: string, text: string): Promise<boolean> {
    const code = linkCodeIn(text);
    if (!code) return false;
    const { count } = await this.prisma.tenant.updateMany({
      where: {
        id: tenant.id,
        ownerLinkCodeHash: hashLinkCode(code),
        ownerLinkExpiresAt: { gt: new Date() },
      },
      data: {
        ownerPsid: psid,
        ownerLinkCodeHash: null,
        ownerLinkExpiresAt: null,
      },
    });
    if (count > 0) this.logger.log(`owner linked tenant=${tenant.id}`);
    await this.send(
      tenant,
      psid,
      count > 0 ? linkedReply(tenant.name) : INVALID_CODE_REPLY,
      'RESPONSE',
    );
    return true;
  }

  /** Runs a "/" command from the owner. Returns false for anything else. */
  async tryCommand(
    tenant: Tenant,
    psid: string,
    text: string,
  ): Promise<boolean> {
    if (!tenant.ownerPsid || tenant.ownerPsid !== psid) return false;
    const command = parseOwnerCommand(text);
    if (!command) return false;

    let reply = helpReply();
    if (command.kind === 'resume') {
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          tenantId: tenant.id,
          id: { endsWith: command.code.toLowerCase() },
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      });
      const resumed = conversation
        ? await this.conversations.resume(tenant.id, conversation.id)
        : false;
      reply = resumedReply(command.code, resumed);
    }
    await this.send(tenant, psid, reply, 'RESPONSE');
    return true;
  }

  async alertHandoff(
    tenant: Tenant,
    conversationId: string,
    reason: string | undefined,
    lastMessage: string | undefined,
  ): Promise<void> {
    await this.alert(
      tenant,
      handoffAlert({
        chatCode: chatCode(conversationId),
        reason,
        lastMessage,
        pauseHours: this.pauseHours,
      }),
    );
  }

  async alertPaidOrder(tenantId: string, order: PaidOrderAlert): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (tenant) await this.alert(tenant, paidOrderAlert(order));
  }

  private async alert(tenant: Tenant, text: string): Promise<void> {
    if (!tenant.ownerPsid) return;
    await this.send(tenant, tenant.ownerPsid, text, 'UPDATE');
  }

  private async send(
    tenant: Tenant,
    psid: string,
    text: string,
    messagingType: MessagingType,
  ): Promise<void> {
    try {
      const token = decryptSecret(
        tenant.pageAccessTokenEncrypted,
        parseEncryptionKey(this.config.get<string>('ENCRYPTION_KEY')),
      );
      await this.graph.sendText(token, psid, text, messagingType);
    } catch (error) {
      // Most often the 24-hour window: the owner hasn't written to the Page lately.
      this.logger.warn(
        `owner message not delivered tenant=${tenant.id}: ${
          error instanceof GraphError
            ? error.describe()
            : error instanceof Error
              ? error.message
              : 'unknown'
        }`,
      );
    }
  }
}
