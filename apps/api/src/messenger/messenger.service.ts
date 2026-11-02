import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentService } from '../agent/agent.service.js';
import { ConversationService } from '../agent/conversation.service.js';
import { decryptSecret, parseEncryptionKey } from '../common/encryption.js';
import type { Prisma } from '../generated/prisma/client.js';
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
import { SerialQueue } from './serial-queue.js';

// Messenger shows "typing…" for about 20 seconds; refresh it while the agent works.
const TYPING_REFRESH_MS = 15_000;

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

    let reply: string | null;
    try {
      reply = (await this.agent.respond(tenant.id, conversation.id, event.text))
        .reply;
    } finally {
      clearInterval(typing);
    }
    if (!reply) return;

    try {
      await this.graph.sendText(token, event.psid, reply);
    } catch (error) {
      this.logger.error(
        `reply not delivered tenant=${tenant.id} conversation=${conversation.id}: ${describe(error)}`,
      );
    }
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
