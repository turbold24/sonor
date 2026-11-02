import { Logger } from '@nestjs/common';
import type { ModelConfig } from '../model.config.js';
import { ModelError, type ModelErrorKind } from '../model.errors.js';
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ModelProvider,
  ToolDefinition,
} from '../model.types.js';
import {
  fromResponsesResponse,
  META_PROVIDER_NAME,
  toResponsesRequest,
} from './meta-responses.mapper.js';

// Retry policy from dev.meta.ai/docs/error-handling: back off with jitter on 429 and
// 5xx, honor Retry-After, and don't retry 504 (the same request usually times out again).
const BASE_RETRY_DELAY_MS = 500;
// A longer Retry-After (503s send 60 s) would stall a customer chat, so fail instead.
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 300;

export interface MetaModelProviderDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Pick<Logger, 'warn'>;
}

interface HttpReply {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

export class MetaModelProvider implements ModelProvider {
  readonly name = META_PROVIDER_NAME;
  readonly model: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly logger: Pick<Logger, 'warn'>;

  constructor(
    private readonly config: ModelConfig,
    deps: MetaModelProviderDeps = {},
  ) {
    this.model = config.model;
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? Math.random;
    this.logger = deps.logger ?? new Logger(MetaModelProvider.name);
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    if (!this.config.apiKey) {
      throw new ModelError('config', 'MODEL_API_KEY is not set');
    }

    const body = toResponsesRequest(messages, tools, {
      model: this.model,
      maxOutputTokens: Math.min(
        options.maxOutputTokens ?? this.config.maxOutputTokens,
        this.config.maxOutputTokens,
      ),
      reasoningEffort: options.reasoningEffort ?? this.config.reasoningEffort,
      parallelToolCalls: options.parallelToolCalls,
      safetyIdentifier: options.safetyIdentifier,
    });

    const reply = await this.post('/responses', body, options.signal);
    return fromResponsesResponse(parseJson(reply.text));
  }

  private async post(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<HttpReply> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
    const payload = JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      const reply = await this.send(url, payload, signal);
      if (reply.ok) return reply;

      const error = toModelError(reply);
      const delayMs = this.retryDelay(error, attempt);
      if (delayMs === undefined) throw error;

      this.logger.warn(
        `Meta Model API ${reply.status} (${error.details.code ?? error.kind}), retry ${attempt + 1}/${this.config.maxRetries} in ${delayMs} ms`,
      );
      await this.sleep(delayMs);
    }
  }

  private async send(
    url: string,
    payload: string,
    signal: AbortSignal | undefined,
  ): Promise<HttpReply> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        text: await response.text(),
      };
    } catch (error) {
      if (timeout.aborted) {
        throw new ModelError(
          'timeout',
          `Meta Model API did not respond within ${this.config.timeoutMs} ms`,
        );
      }
      if (signal?.aborted) throw error;
      throw new ModelError(
        'network',
        `Could not reach Meta Model API: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private retryDelay(error: ModelError, attempt: number): number | undefined {
    if (!error.retryable || attempt >= this.config.maxRetries) return undefined;

    const retryAfterMs = error.details.retryAfterMs;
    if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_DELAY_MS) {
      return undefined;
    }
    const backoffMs =
      BASE_RETRY_DELAY_MS * 2 ** attempt +
      Math.floor(this.random() * BASE_RETRY_DELAY_MS);
    return Math.max(backoffMs, retryAfterMs ?? 0);
  }
}

function toModelError(reply: HttpReply): ModelError {
  const body = safeParseJson(reply.text);
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error: Record<string, unknown> }).error
      : {};
  const message =
    typeof error.message === 'string'
      ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : `HTTP ${reply.status}`;
  const code = typeof error.code === 'string' ? error.code : null;
  const { status } = reply;

  return new ModelError(
    errorKind(status),
    `Meta Model API ${status}: ${message}`,
    {
      status,
      code,
      retryAfterMs: parseRetryAfter(reply.headers.get('retry-after')),
    },
    status === 429 || (status >= 500 && status !== 504),
  );
}

function errorKind(status: number): ModelErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'billing';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parseJson(text: string): unknown {
  const parsed = safeParseJson(text);
  if (parsed === undefined) {
    throw new ModelError(
      'invalid_response',
      'Meta Model API returned a non-JSON response',
    );
  }
  return parsed;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
