import type { MessageRole } from '../generated/prisma/client.js';
import type { ChatMessage, ToolCall } from '../model/model.types.js';

export interface StoredMessage {
  role: MessageRole;
  text: string | null;
  toolCalls: unknown;
}

// Type aliases rather than interfaces so they're assignable to Prisma JSON input.

/** How tool-call steps are stored on AGENT messages. */
export type StoredToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** How TOOL messages point at their call. */
export type StoredToolResult = {
  callId: string;
  name: string;
};

/**
 * Rebuilds model history from stored messages (oldest first). Owner replies count as
 * the shop's side. Tool calls are kept only with their results, so a window that cuts
 * through a tool step never produces an unpaired call.
 */
export function toChatHistory(rows: StoredMessage[]): ChatMessage[] {
  const outputs = new Map<string, string>();
  for (const row of rows) {
    const result = storedResult(row);
    if (result) outputs.set(result.callId, row.text ?? '');
  }

  const history: ChatMessage[] = [];
  for (const row of rows) {
    switch (row.role) {
      case 'CUSTOMER':
        if (row.text) history.push({ role: 'user', content: row.text });
        break;

      case 'OWNER':
        if (row.text) history.push({ role: 'assistant', content: row.text });
        break;

      case 'AGENT': {
        const calls = storedCalls(row.toolCalls).filter((call) =>
          outputs.has(call.id),
        );
        if (!row.text && calls.length === 0) break;
        history.push({
          role: 'assistant',
          content: row.text,
          toolCalls: calls.map(toToolCall),
        });
        for (const call of calls) {
          history.push({
            role: 'tool',
            toolCallId: call.id,
            content: outputs.get(call.id) ?? '',
          });
        }
        break;
      }

      default:
        // TOOL rows are emitted with their call above; SYSTEM rows are notes for the owner.
        break;
    }
  }
  return history;
}

function toToolCall(call: StoredToolCall): ToolCall {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    // Keep the raw string; replay only needs that.
  }
  return {
    id: call.id,
    name: call.name,
    rawArguments: call.arguments,
    arguments: isRecord(parsed) ? parsed : null,
  };
}

function storedCalls(value: unknown): StoredToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StoredToolCall =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.arguments === 'string',
  );
}

function storedResult(row: StoredMessage): StoredToolResult | undefined {
  const value = row.toolCalls;
  if (
    row.role === 'TOOL' &&
    isRecord(value) &&
    typeof value.callId === 'string' &&
    typeof value.name === 'string'
  ) {
    return { callId: value.callId, name: value.name };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
