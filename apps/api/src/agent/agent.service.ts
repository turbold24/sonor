import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toolError } from '../catalog/catalog.types.js';
import { ConnectorRegistry } from '../catalog/connector.registry.js';
import { detectScript } from '../common/mongolian-script.js';
import { PHOTO_MARKER } from '../common/photos.js';
import type {
  MessageRole,
  Prisma,
  Tenant,
} from '../generated/prisma/client.js';
import { ModelError } from '../model/model.errors.js';
import { ModelService } from '../model/model.service.js';
import type {
  ChatMessage,
  ImageInput,
  ToolCall,
  ToolDefinition,
  TokenUsage,
} from '../model/model.types.js';
import { ORDER_TOOL_NAMES, ORDER_TOOLS } from '../orders/order.tools.js';
import { OrderService, type PaymentLinkInfo } from '../orders/order.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  answerNowNotice,
  buildSystemPrompt,
  fallbackReply,
  groundingCorrection,
  unsupportedMediaReply,
} from './agent.prompt.js';
import {
  runAgentTurn,
  type TurnFallback,
  type TurnOutcome,
} from './agent-turn.js';
import { needsDisclosure, withDisclosure } from './disclosure.js';
import { numbersIn } from './grounding.js';
import { HANDOFF_TOOL, HANDOFF_TOOL_NAME } from './handoff.tool.js';
import {
  toChatHistory,
  type StoredMessage,
  type StoredToolCall,
} from './history.js';
import { validateToolArgs } from './tool-args.js';

const MAX_ITERATIONS = 4;
const HISTORY_LIMIT = 30;
const MAX_TOOL_OUTPUT_CHARS = 6000;
const DEFAULT_PAUSE_HOURS = 12;

export interface IncomingMessage {
  /** Empty for attachment-only messages. */
  text: string;
  /** Channel message ID (Messenger mid). A message seen before is ignored. */
  externalId?: string;
  attachments?: Prisma.InputJsonValue;
}

/** ready: answer it; paused: a human is handling the chat; duplicate: already received. */
export type ReceiveStatus = 'ready' | 'paused' | 'duplicate';

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown> | null;
  output: string;
}

export interface AgentReply {
  /** Null when the agent stays silent (paused or duplicate). */
  reply: string | null;
  paused: boolean;
  duplicate: boolean;
  handoff: boolean;
  toolCalls: AgentToolCall[];
  usage: TokenUsage & { calls: number };
  regenerated: boolean;
  fallback: TurnFallback | 'model_error';
  /** A payment link confirm_order created this turn, for the channel to send as a button. */
  paymentLink: PaymentLinkInfo | null;
  /** The reply asks the customer to confirm a new draft order; channels can offer yes/no. */
  askConfirmation: boolean;
}

interface TurnContext {
  tenant: Tenant;
  conversationId: string;
  tools: Map<string, ToolDefinition>;
  paymentLink?: PaymentLinkInfo;
  /** The turn's last order tool left a draft waiting for a yes. */
  awaitingConfirmation?: boolean;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly pauseMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly model: ModelService,
    private readonly connectors: ConnectorRegistry,
    private readonly orders: OrderService,
    config: ConfigService,
  ) {
    const hours = Number(config.get<string>('BOT_PAUSE_HOURS'));
    this.pauseMs =
      (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_PAUSE_HOURS) *
      3_600_000;
  }

  /** Saves the customer's message and, unless the bot is paused, answers it. */
  async reply(
    tenantId: string,
    conversationId: string,
    customerText: string,
    message: Omit<IncomingMessage, 'text'> = {},
    images: ImageInput[] = [],
  ): Promise<AgentReply> {
    const status = await this.receive(tenantId, conversationId, {
      ...message,
      text: customerText,
    });
    if (status !== 'ready') return silentReply(status);
    return this.respond(tenantId, conversationId, customerText, images);
  }

  /**
   * Saves an incoming customer message (once per externalId) and says whether to answer
   * it. A paused conversation resumes on its own after BOT_PAUSE_HOURS.
   */
  async receive(
    tenantId: string,
    conversationId: string,
    message: IncomingMessage,
  ): Promise<ReceiveStatus> {
    const conversation = await this.findConversation(tenantId, conversationId);
    const now = new Date();
    const { count } = await this.prisma.message.createMany({
      data: [
        {
          tenantId,
          conversationId,
          role: 'CUSTOMER',
          text: message.text.trim() || null,
          externalId: message.externalId,
          attachments: message.attachments,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return 'duplicate';
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { lastMessageAt: now },
    });

    if (!conversation.tenant.active) return 'paused';
    if (!conversation.botPaused) return 'ready';
    const pausedAt = conversation.pausedAt?.getTime() ?? now.getTime();
    if (now.getTime() - pausedAt < this.pauseMs) return 'paused';

    await this.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId },
      data: { botPaused: false, pausedAt: null },
    });
    this.logger.log(
      `bot resumed after pause tenant=${tenantId} conversation=${conversationId}`,
    );
    return 'ready';
  }

  /**
   * Answers the latest customer message, which receive() has already saved. `images` are
   * that message's photos, already downloaded; the model sees them only on this turn.
   */
  async respond(
    tenantId: string,
    conversationId: string,
    customerText: string,
    images: ImageInput[] = [],
  ): Promise<AgentReply> {
    const conversation = await this.findConversation(tenantId, conversationId);
    const { tenant } = conversation;

    const disclose = await this.mustDisclose(tenantId, conversationId);

    if (!customerText.trim() && images.length === 0) {
      // Nothing the agent can read: voice, video, a sticker, or a photo that didn't load.
      const note = unsupportedMediaReply();
      const reply = disclose ? withDisclosure(note, 'cyrillic') : note;
      await this.save(tenant.id, conversationId, [
        { role: 'AGENT', text: reply },
      ]);
      return { ...silentReply('ready'), reply };
    }

    const connector = this.connectors.forTenant(tenant);
    const [connectorTools, brief, rows] = await Promise.all([
      connector.tools(tenant).catch((error: unknown) => {
        this.logger.warn(
          `tools unavailable tenant=${tenant.id}: ${errorName(error)}`,
        );
        return [];
      }),
      connector.brief(tenant).catch(() => null),
      this.prisma.message.findMany({
        where: { tenantId, conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
        select: { role: true, text: true, toolCalls: true, attachments: true },
      }),
    ]);
    const history = withImages(toChatHistory([...rows].reverse()), images);

    // Orders are built in for DEMO tenants, whose catalog and prices live in Sonor.
    const ordering = tenant.connectorType === 'DEMO';
    const tools = [
      ...connectorTools.filter(
        (tool) =>
          tool.name !== HANDOFF_TOOL_NAME && !ORDER_TOOL_NAMES.has(tool.name),
      ),
      ...(ordering ? ORDER_TOOLS : []),
      HANDOFF_TOOL,
    ];
    const context: TurnContext = {
      tenant,
      conversationId,
      tools: new Map(tools.map((tool) => [tool.name, tool])),
    };
    // A photo without text: answer in the script the customer last wrote in.
    const script = detectScript(customerText.trim() || lastCustomerText(rows));
    const safetyIdentifier = createHash('sha256')
      .update(`${tenant.id}:${conversation.customerId}`)
      .digest('hex')
      .slice(0, 32);

    let outcome: TurnOutcome | undefined;
    let fallback: AgentReply['fallback'];
    try {
      outcome = await runAgentTurn(
        {
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(tenant, brief, script, { ordering }),
            },
            ...history,
          ],
          tools,
          maxIterations: MAX_ITERATIONS,
          allowedNumbers: numbersIn([
            tenant.agentHandoffContact ?? '',
            tenant.agentGreeting ?? '',
          ]),
          fallbackReply: fallbackReply(tenant, script),
          correction: groundingCorrection,
          answerNow: answerNowNotice(),
        },
        {
          chat: (messages, turnTools) =>
            this.model.chat(messages, turnTools, {
              tenantId: tenant.id,
              reasoningEffort: 'low',
              safetyIdentifier,
            }),
          runTool: (call) => this.runTool(context, call),
        },
      );
      fallback = outcome.fallback;
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      this.logger.warn(
        `agent turn failed tenant=${tenant.id} conversation=${conversationId} kind=${error.kind}`,
      );
      fallback = 'model_error';
    }

    const answer = outcome?.reply ?? fallbackReply(tenant, script);
    const reply = disclose ? withDisclosure(answer, script) : answer;
    const steps = outcome?.steps ?? [];
    await this.save(tenant.id, conversationId, [
      ...steps.flatMap((step) => [
        {
          role: 'AGENT' as const,
          text: null,
          toolCalls: step.calls.map((call): StoredToolCall => ({
            id: call.id,
            name: call.name,
            arguments: call.rawArguments,
          })),
        },
        ...step.calls.map((call, i) => ({
          role: 'TOOL' as const,
          text: step.outputs[i],
          toolCalls: { callId: call.id, name: call.name },
        })),
      ]),
      { role: 'AGENT', text: reply },
    ]);

    const toolCalls = steps.flatMap((step) =>
      step.calls.map((call, i) => ({
        name: call.name,
        arguments: call.arguments,
        output: step.outputs[i],
      })),
    );
    const handoff = toolCalls.some((call) => call.name === HANDOFF_TOOL_NAME);
    return {
      reply,
      paused: false,
      duplicate: false,
      handoff,
      toolCalls,
      usage: outcome?.usage ?? emptyUsage(),
      regenerated: outcome?.regenerated ?? false,
      fallback,
      paymentLink: context.paymentLink ?? null,
      askConfirmation:
        context.awaitingConfirmation === true &&
        fallback === 'none' &&
        !handoff,
    };
  }

  private async runTool(context: TurnContext, call: ToolCall): Promise<string> {
    const tool = context.tools.get(call.name);
    if (!tool) {
      return serialize(
        toolError('unknown_tool', `No tool named ${call.name}.`),
      );
    }
    const validated = validateToolArgs(tool.parameters, call.arguments);
    if (!validated.ok) {
      return serialize(toolError('invalid_arguments', validated.error));
    }

    const { tenant, conversationId } = context;
    try {
      if (call.name === HANDOFF_TOOL_NAME) {
        await this.prisma.conversation.updateMany({
          where: { id: conversationId, tenantId: tenant.id },
          data: { botPaused: true, pausedAt: new Date() },
        });
        return serialize({
          handedOff: true,
          contact: tenant.agentHandoffContact,
        });
      }
      if (ORDER_TOOL_NAMES.has(call.name)) {
        const result = await this.orders.runTool(
          tenant.id,
          conversationId,
          call.name,
          validated.args,
        );
        if (result.paymentLink) context.paymentLink = result.paymentLink;
        context.awaitingConfirmation = result.awaitingConfirmation === true;
        return serialize(result.output);
      }
      const connector = this.connectors.forTenant(tenant);
      return serialize(
        await connector.execute(tenant, call.name, validated.args),
      );
    } catch (error) {
      this.logger.warn(
        `tool ${call.name} failed tenant=${tenant.id}: ${errorName(error)}`,
      );
      return serialize(
        toolError('tool_failed', 'The tool failed. Offer a human if needed.'),
      );
    }
  }

  /** Whether this reply must say it's automated (see disclosure.ts). */
  private async mustDisclose(
    tenantId: string,
    conversationId: string,
  ): Promise<boolean> {
    const history = await this.prisma.message.findMany({
      where: {
        tenantId,
        conversationId,
        OR: [{ role: 'AGENT', text: { not: null } }, { role: 'OWNER' }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { role: true, createdAt: true },
    });
    return needsDisclosure(history, new Date());
  }

  private async findConversation(tenantId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { tenant: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async save(
    tenantId: string,
    conversationId: string,
    messages: {
      role: MessageRole;
      text: string | null;
      toolCalls?: Prisma.InputJsonValue;
    }[],
  ): Promise<void> {
    // Explicit, increasing timestamps keep the order stable within one turn.
    const now = Date.now();
    await this.prisma.$transaction([
      this.prisma.message.createMany({
        data: messages.map((message, i) => ({
          tenantId,
          conversationId,
          role: message.role,
          text: message.text,
          toolCalls: message.toolCalls,
          createdAt: new Date(now + i),
        })),
      }),
      this.prisma.conversation.updateMany({
        where: { id: conversationId, tenantId },
        data: { lastMessageAt: new Date(now + messages.length) },
      }),
    ]);
  }
}

function serialize(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json.length > MAX_TOOL_OUTPUT_CHARS
    ? `${json.slice(0, MAX_TOOL_OUTPUT_CHARS)}…(truncated)`
    : json;
}

/** Attaches the current message's photos to its user turn, the last one in history. */
function withImages(
  history: ChatMessage[],
  images: ImageInput[],
): ChatMessage[] {
  if (images.length === 0) return history;
  const last = history.at(-1);
  if (last?.role === 'user') {
    return [...history.slice(0, -1), { ...last, images }];
  }
  return [...history, { role: 'user', content: PHOTO_MARKER, images }];
}

/** The newest customer text in rows ordered newest first. */
function lastCustomerText(rows: StoredMessage[]): string {
  return rows.find((row) => row.role === 'CUSTOMER' && row.text)?.text ?? '';
}

function silentReply(status: ReceiveStatus): AgentReply {
  return {
    reply: null,
    paused: status === 'paused',
    duplicate: status === 'duplicate',
    handoff: false,
    toolCalls: [],
    usage: emptyUsage(),
    regenerated: false,
    fallback: 'none',
    paymentLink: null,
    askConfirmation: false,
  };
}

function emptyUsage(): TokenUsage & { calls: number } {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    calls: 0,
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
}
