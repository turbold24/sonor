import { ModelError } from '../model.errors.js';
import type {
  ChatMessage,
  ChatResult,
  FinishReason,
  ProviderState,
  ReasoningEffort,
  ToolCall,
  ToolDefinition,
} from '../model.types.js';

// Maps between the neutral model types and the Meta Model API Responses format
// (POST /v1/responses, see dev.meta.ai/docs/protocols/responses). Requests are
// stateless: store=false, and reasoning comes back encrypted so it can be replayed.

export const META_PROVIDER_NAME = 'meta';

type Item = Record<string, unknown>;

export interface ResponsesRequestOptions {
  model: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  parallelToolCalls?: boolean;
  safetyIdentifier?: string;
}

export function toResponsesRequest(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: ResponsesRequestOptions,
): Item {
  const body: Item = {
    model: options.model,
    input: messages.flatMap(toInputItems),
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: options.reasoningEffort },
    store: false,
    include: ['reasoning.encrypted_content'],
  };
  if (tools.length > 0) body.tools = tools.map(toFunctionTool);
  if (options.parallelToolCalls !== undefined) {
    body.parallel_tool_calls = options.parallelToolCalls;
  }
  if (options.safetyIdentifier) {
    body.safety_identifier = options.safetyIdentifier;
  }
  return body;
}

function toFunctionTool(tool: ToolDefinition): Item {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    // The docs disagree on the default; strict only adds server-side schema checks.
    strict: false,
  };
}

function toInputItems(message: ChatMessage): Item[] {
  switch (message.role) {
    case 'system':
      return [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: message.content }],
        },
      ];

    case 'user':
      return [
        {
          type: 'message',
          role: 'user',
          content: [
            ...(message.content
              ? [{ type: 'input_text', text: message.content }]
              : []),
            ...(message.images ?? []).map((image) => ({
              type: 'input_image',
              image_url: image.url,
            })),
          ],
        },
      ];

    case 'assistant': {
      const replay = replayItems(message.providerState);
      if (replay) return replay;

      const toolCalls = message.toolCalls ?? [];
      const items: Item[] = [];
      if (message.content) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
          // Text right before a function_call must be tagged as commentary.
          ...(toolCalls.length > 0 ? { phase: 'commentary' } : {}),
        });
      }
      for (const call of toolCalls) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.rawArguments,
        });
      }
      return items;
    }

    case 'tool':
      return [
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: message.content,
        },
      ];
  }
}

/** Output items saved from an earlier Meta response, replayed verbatim. */
function replayItems(state: ProviderState | undefined): Item[] | undefined {
  if (state?.provider !== META_PROVIDER_NAME || !Array.isArray(state.data)) {
    return undefined;
  }
  return state.data.filter(isRecord);
}

export function fromResponsesResponse(body: unknown): ChatResult {
  if (!isRecord(body) || !Array.isArray(body.output)) {
    throw new ModelError(
      'invalid_response',
      'Unexpected response shape from Meta Model API',
    );
  }
  if (body.status === 'failed') {
    const error = isRecord(body.error) ? body.error : {};
    throw new ModelError(
      'server',
      `Meta Model API response failed: ${string(error.message) ?? 'unknown error'}`,
      { code: string(error.code) ?? null },
    );
  }
  if (body.status !== 'completed' && body.status !== 'incomplete') {
    throw new ModelError(
      'invalid_response',
      `Unexpected response status: ${String(body.status)}`,
    );
  }

  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const replay: Item[] = [];

  for (const item of body.output.filter(isRecord)) {
    switch (item.type) {
      case 'reasoning':
        // Without encrypted_content a reasoning item can't be replayed.
        if (typeof item.encrypted_content === 'string') {
          replay.push({
            type: 'reasoning',
            ...(typeof item.id === 'string' ? { id: item.id } : {}),
            summary: Array.isArray(item.summary) ? item.summary : [],
            encrypted_content: item.encrypted_content,
          });
        }
        break;

      case 'message': {
        const text = outputText(item.content);
        if (!text) break;
        const phase = string(item.phase);
        // Commentary is the model's preamble before a tool call, not the answer.
        if (phase !== 'commentary') textParts.push(text);
        replay.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
          ...(phase ? { phase } : {}),
        });
        break;
      }

      case 'function_call': {
        // A call cut off by the output limit has unusable arguments.
        if (item.status === 'incomplete') break;
        const id = string(item.call_id);
        const name = string(item.name);
        if (!id || !name) {
          throw new ModelError(
            'invalid_response',
            'Function call without call_id or name',
          );
        }
        const rawArguments = string(item.arguments) ?? '';
        toolCalls.push({
          id,
          name,
          rawArguments,
          arguments: parseArguments(rawArguments),
        });
        replay.push({
          type: 'function_call',
          call_id: id,
          name,
          arguments: rawArguments,
        });
        break;
      }
    }
  }

  // A reasoning item must be followed by a message or function_call on replay.
  while (replay.at(-1)?.type === 'reasoning') replay.pop();

  return {
    text: textParts.length > 0 ? textParts.join('\n\n') : null,
    toolCalls,
    finishReason: finishReason(body, toolCalls.length > 0),
    usage: usage(body.usage),
    model: string(body.model) ?? '',
    providerState:
      replay.length > 0
        ? { provider: META_PROVIDER_NAME, data: replay }
        : undefined,
  };
}

function finishReason(body: Item, hasToolCalls: boolean): FinishReason {
  if (body.status === 'incomplete') {
    const reason = isRecord(body.incomplete_details)
      ? body.incomplete_details.reason
      : undefined;
    if (reason === 'max_output_tokens') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    return 'other';
  }
  return hasToolCalls ? 'tool_calls' : 'stop';
}

function usage(value: unknown): ChatResult['usage'] {
  const raw = isRecord(value) ? value : {};
  const inputDetails = isRecord(raw.input_tokens_details)
    ? raw.input_tokens_details
    : {};
  const outputDetails = isRecord(raw.output_tokens_details)
    ? raw.output_tokens_details
    : {};
  const inputTokens = number(raw.input_tokens);
  const outputTokens = number(raw.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: number(raw.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: number(inputDetails.cached_tokens),
    reasoningTokens: number(outputDetails.reasoning_tokens),
  };
}

function outputText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .filter((part) => part.type === 'output_text')
    .map((part) => string(part.text) ?? '')
    .join('');
}

function parseArguments(raw: string): Record<string, unknown> | null {
  if (raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
