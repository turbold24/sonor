// Provider-neutral model interface. The agent depends only on these types, so
// switching from Muse Spark on Meta Model API to another provider is a config change.

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Arguments exactly as the model produced them (a JSON string). */
  rawArguments: string;
  /** Parsed arguments, or null if they weren't a JSON object. Not schema-validated. */
  arguments: Record<string, unknown> | null;
}

/** A public https URL or a base64 data: URL. */
export interface ImageInput {
  url: string;
}

/**
 * Opaque data a provider needs to continue the conversation (for Meta: encrypted
 * reasoning). Store it with the assistant message and send it back unchanged.
 * Other providers ignore it.
 */
export interface ProviderState {
  provider: string;
  data: unknown;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: ImageInput[] }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: ToolCall[];
      providerState?: ProviderState;
    }
  | { role: 'tool'; toolCallId: string; content: string };

export type ReasoningEffort =
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatOptions {
  /** Lowers the configured MODEL_MAX_OUTPUT_TOKENS for this call; never raises it. */
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  parallelToolCalls?: boolean;
  /** Stable, privacy-preserving end-user ID (e.g. a hash), at most 64 characters. */
  safetyIdentifier?: string;
  signal?: AbortSignal;
}

export type FinishReason =
  'stop' | 'tool_calls' | 'length' | 'content_filter' | 'other';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  /** Counted within outputTokens. */
  reasoningTokens: number;
}

export interface ChatResult {
  /** User-facing text, or null when the model only called tools. */
  text: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
  model: string;
  providerState?: ProviderState;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResult>;
}

export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

/** The assistant turn to append to history after a call, including provider state. */
export function toAssistantMessage(result: ChatResult): ChatMessage {
  return {
    role: 'assistant',
    content: result.text,
    toolCalls: result.toolCalls,
    providerState: result.providerState,
  };
}
