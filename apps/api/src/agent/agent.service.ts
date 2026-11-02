import { createHash } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { toolError } from '../catalog/catalog.types.js';
import { ConnectorRegistry } from '../catalog/connector.registry.js';
import { detectScript } from '../common/mongolian-script.js';
import type {
  MessageRole,
  Prisma,
  Tenant,
} from '../generated/prisma/client.js';
import { ModelError } from '../model/model.errors.js';
import { ModelService } from '../model/model.service.js';
import type {
  ToolCall,
  ToolDefinition,
  TokenUsage,
} from '../model/model.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildSystemPrompt,
  fallbackReply,
  groundingCorrection,
} from './agent.prompt.js';
import {
  runAgentTurn,
  type TurnFallback,
  type TurnOutcome,
} from './agent-turn.js';
import { numbersIn } from './grounding.js';
import { HANDOFF_TOOL, HANDOFF_TOOL_NAME } from './handoff.tool.js';
import { toChatHistory, type StoredToolCall } from './history.js';
import { validateToolArgs } from './tool-args.js';

const MAX_ITERATIONS = 4;
const HISTORY_LIMIT = 30;
const MAX_TOOL_OUTPUT_CHARS = 6000;

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown> | null;
  output: string;
}

export interface AgentReply {
  /** Null when the conversation is paused for a human. */
  reply: string | null;
  paused: boolean;
  handoff: boolean;
  toolCalls: AgentToolCall[];
  usage: TokenUsage & { calls: number };
  regenerated: boolean;
  fallback: TurnFallback | 'model_error';
}

interface TurnContext {
  tenant: Tenant;
  conversationId: string;
  tools: Map<string, ToolDefinition>;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly model: ModelService,
    private readonly connectors: ConnectorRegistry,
  ) {}

  async reply(
    tenantId: string,
    conversationId: string,
    customerText: string,
  ): Promise<AgentReply> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { tenant: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const { tenant } = conversation;

    await this.save(tenant.id, conversationId, [
      { role: 'CUSTOMER', text: customerText },
    ]);
    if (conversation.botPaused || !tenant.active) return pausedReply();

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
        select: { role: true, text: true, toolCalls: true },
      }),
    ]);

    const tools = [
      ...connectorTools.filter((tool) => tool.name !== HANDOFF_TOOL_NAME),
      HANDOFF_TOOL,
    ];
    const context: TurnContext = {
      tenant,
      conversationId,
      tools: new Map(tools.map((tool) => [tool.name, tool])),
    };
    const script = detectScript(customerText);
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
              content: buildSystemPrompt(tenant, brief, script),
            },
            ...toChatHistory(rows.reverse()),
          ],
          tools,
          maxIterations: MAX_ITERATIONS,
          allowedNumbers: numbersIn([
            tenant.agentHandoffContact ?? '',
            tenant.agentGreeting ?? '',
          ]),
          fallbackReply: fallbackReply(tenant, script),
          correction: groundingCorrection,
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

    const reply = outcome?.reply ?? fallbackReply(tenant, script);
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
    return {
      reply,
      paused: false,
      handoff: toolCalls.some((call) => call.name === HANDOFF_TOOL_NAME),
      toolCalls,
      usage: outcome?.usage ?? emptyUsage(),
      regenerated: outcome?.regenerated ?? false,
      fallback,
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

function pausedReply(): AgentReply {
  return {
    reply: null,
    paused: true,
    handoff: false,
    toolCalls: [],
    usage: emptyUsage(),
    regenerated: false,
    fallback: 'none',
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
