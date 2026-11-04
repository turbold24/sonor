import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService, type AgentReply } from '../agent/agent.service.js';
import { ConversationService } from '../agent/conversation.service.js';
import { HANDOFF_TOOL_NAME } from '../agent/handoff.tool.js';
import { decryptSecret, parseEncryptionKey } from '../common/encryption.js';
import { detectScript, type Script } from '../common/mongolian-script.js';
import { PHOTO_MARKER, photoUrls } from '../common/photos.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ImageInput } from '../model/model.types.js';
import {
  confirmQuickReplies,
  paymentButtonText,
  paymentButtonTitle,
} from '../orders/order-messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GraphClient,
  GraphError,
  OWN_MESSAGE_METADATA,
  type SenderAction,
} from './graph.client.js';
import { MESSENGER_CONFIG, type MessengerConfig } from './messenger.config.js';
import {
  parseWebhook,
  type EchoEvent,
  type MessengerEvent,
} from './messenger.events.js';
import { OwnerService } from './owner.service.js';
import { SerialQueue } from './serial-queue.js';

// Messenger shows "typing…" for about 20 seconds; refresh it while the agent works.
const TYPING_REFRESH_MS = 15_000;
// /dev/chat customers; they have no real Messenger PSID to send to.
const DEV_PSID_PREFIX = 'dev:';

@Injectable()
export class MessengerService {
  private readonly logger = new Logger(MessengerService.name);
  private readonly queue = new SerialQueue((key, error) =>
    this.logger.error(`event failed for ${key}: ${describe(error)}`),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly agent: AgentService,
    private readonly graph: GraphClient,
    private readonly owner: OwnerService,
    private readonly config: ConfigService,
    @Inject(MESSENGER_CONFIG) private readonly messenger: MessengerConfig,
  ) {}

  /**
   * Queues a verified webhook's events and returns at once, so the webhook can answer
   * 200 within Meta's 5 seconds. Each customer's events run in order.
   */
  accept(payload: unknown): void {
    for (const event of parseWebhook(payload)) {
      void this.queue.run(`${event.pageId}:${event.psid}`, () =>
        this.handle(event),
      );
    }
  }

  /** Resolves when all queued events are handled (for tests and shutdown). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  private async handle(event: MessengerEvent): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { facebookPageId: event.pageId },
    });
    if (!tenant) {
      this.logger.warn(`ignoring event for unknown Page ${event.pageId}`);
      return;
    }
    if (event.kind === 'echo' && this.isOwnEcho(event)) return;
    if (
      event.kind === 'message' &&
      ((await this.owner.tryLink(tenant, event.psid, event.text)) ||
        (await this.owner.tryCommand(tenant, event.psid, event.text)))
    ) {
      return;
    }

    const conversation = await this.conversations.findOrStart(
      tenant.id,
      event.psid,
    );
    const message = {
      text: event.text,
      externalId: event.mid,
      // Plain JSON from the webhook, kept as received.
      attachments: event.attachments.length
        ? (event.attachments as unknown as Prisma.InputJsonValue)
        : undefined,
    };

    if (event.kind === 'echo') {
      // Sent by hand from the Page inbox: the owner has taken over.
      const saved = await this.conversations.recordOwnerMessage(
        tenant.id,
        conversation.id,
        message,
      );
      if (saved) {
        this.logger.log(
          `owner replied, bot paused tenant=${tenant.id} conversation=${conversation.id}`,
        );
      }
      return;
    }

    const status = await this.agent.receive(
      tenant.id,
      conversation.id,
      message,
    );
    if (status !== 'ready') return;

    const token = decryptSecret(
      tenant.pageAccessTokenEncrypted,
      parseEncryptionKey(this.config.get<string>('ENCRYPTION_KEY')),
    );
    await this.indicate(token, event.psid, 'mark_seen');
    await this.indicate(token, event.psid, 'typing_on');
    const typing = setInterval(
      () => void this.indicate(token, event.psid, 'typing_on'),
      TYPING_REFRESH_MS,
    );

    let result: AgentReply;
    try {
      const images = await this.readPhotos(tenant.id, event);
      result = await this.agent.respond(
        tenant.id,
        conversation.id,
        event.text,
        images,
      );
    } finally {
      clearInterval(typing);
    }
    if (!result.reply) return;

    try {
      const script = detectScript(event.text);
      await this.graph.sendText(
        token,
        event.psid,
        result.reply,
        'RESPONSE',
        result.askConfirmation ? confirmQuickReplies(script) : [],
      );
      const link = result.paymentLink;
      if (link) {
        // Sent by Sonor, not written by the model, so the URL is always exact.
        await this.graph.sendUrlButtons(
          token,
          event.psid,
          paymentButtonText(script, link.orderCode, link.total),
          [{ url: link.url, title: paymentButtonTitle(script) }],
        );
      }
    } catch (error) {
      this.logger.error(
        `reply not delivered tenant=${tenant.id} conversation=${conversation.id}: ${describe(error)}`,
      );
    }

    if (result.handoff) {
      const reason = result.toolCalls.find(
        (call) => call.name === HANDOFF_TOOL_NAME,
      )?.arguments?.reason;
      await this.owner.alertHandoff(
        tenant,
        conversation.id,
        typeof reason === 'string' ? reason : undefined,
        // The agent answered, so a message without text had a photo.
        event.text || PHOTO_MARKER,
      );
    }
  }

  /**
   * Sends the customer a message Sonor wrote itself (not a reply to their message), in
   * the script they last wrote in, and saves it to the conversation.
   */
  async notifyCustomer(
    tenantId: string,
    conversationId: string,
    textFor: (script: Script) => string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        tenant: true,
        customer: { select: { psid: true } },
        messages: {
          where: { role: 'CUSTOMER', text: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { text: true },
        },
      },
    });
    if (!conversation) return;
    const text = textFor(detectScript(conversation.messages[0]?.text ?? ''));
    await this.prisma.message.create({
      data: { tenantId, conversationId, role: 'AGENT', text },
    });

    const { psid } = conversation.customer;
    if (psid.startsWith(DEV_PSID_PREFIX)) return;
    try {
      const token = decryptSecret(
        conversation.tenant.pageAccessTokenEncrypted,
        parseEncryptionKey(this.config.get<string>('ENCRYPTION_KEY')),
      );
      await this.graph.sendText(token, psid, text, 'UPDATE');
    } catch (error) {
      this.logger.error(
        `notice not delivered tenant=${tenantId} conversation=${conversationId}: ${describe(error)}`,
      );
    }
  }

  /** Downloads the event's photos. One that fails is logged and left out. */
  private async readPhotos(
    tenantId: string,
    event: MessengerEvent,
  ): Promise<ImageInput[]> {
    const results = await Promise.allSettled(
      photoUrls(event.attachments).map((url) => this.graph.fetchPhoto(url)),
    );
    return results.flatMap((result) => {
      if (result.status === 'fulfilled') return [result.value];
      this.logger.warn(
        `photo not read tenant=${tenantId}: ${describe(result.reason)}`,
      );
      return [];
    });
  }

  /** Echoes of Sonor's own replies carry our metadata tag (and our app ID). */
  private isOwnEcho(event: EchoEvent): boolean {
    return (
      event.metadata === OWN_MESSAGE_METADATA ||
      (this.messenger.appId !== undefined &&
        event.appId === this.messenger.appId)
    );
  }

  private async indicate(
    token: string,
    psid: string,
    action: SenderAction,
  ): Promise<void> {
    try {
      await this.graph.sendAction(token, psid, action);
    } catch (error) {
      this.logger.warn(`sender action ${action} failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof GraphError) return error.describe();
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
}
