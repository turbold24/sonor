import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { splitMessage } from './message-split.js';

// Messenger Send API on the Graph API (dev docs: send-messages, sender-actions).
// The Page access token goes in the access_token query parameter as the docs show,
// with appsecret_proof when an App Secret is configured. URLs are never logged, so the
// token never reaches the logs.

const GRAPH_BASE_URL = 'https://graph.facebook.com';
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1000;
const MAX_ERROR_MESSAGE_LENGTH = 200;
// Graph error codes worth one retry: temporary service errors and rate limits.
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

/** Sent as message metadata so Sonor can recognize the echoes of its own replies. */
export const OWN_MESSAGE_METADATA = 'sonor';

export type SenderAction = 'mark_seen' | 'typing_on' | 'typing_off';

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
    readonly transient = false,
  ) {
    super(message);
    this.name = 'GraphError';
  }

  /** For logs: codes and trace ID only. */
  describe(): string {
    return `status=${this.status ?? '-'} code=${this.code ?? '-'} subcode=${this.subcode ?? '-'} fbtrace=${this.fbtraceId ?? '-'} ${this.message}`;
  }
}

export interface GraphClientOptions {
  /** e.g. "v26.0" */
  version: string;
  appSecret?: string;
}

export interface GraphClientDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Logger, 'warn'>;
}

export class GraphClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: Pick<Logger, 'warn'>;

  constructor(
    private readonly options: GraphClientOptions,
    deps: GraphClientDeps = {},
  ) {
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = deps.logger ?? new Logger(GraphClient.name);
  }

  /** mark_seen, typing_on or typing_off. Must be its own request. */
  async sendAction(
    pageToken: string,
    psid: string,
    action: SenderAction,
  ): Promise<void> {
    await this.request('POST', '/me/messages', pageToken, {
      recipient: { id: psid },
      sender_action: action,
    });
  }

  /** Sends a reply, split into parts of at most 2000 characters. Returns message IDs. */
  async sendText(
    pageToken: string,
    psid: string,
    text: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const part of splitMessage(text)) {
      const response = await this.request('POST', '/me/messages', pageToken, {
        recipient: { id: psid },
        messaging_type: 'RESPONSE',
        message: { text: part, metadata: OWN_MESSAGE_METADATA },
      });
      if (typeof response.message_id === 'string') {
        ids.push(response.message_id);
      }
    }
    return ids;
  }

  /** The Page a Page access token belongs to. */
  async page(pageToken: string): Promise<{ id: string; name: string }> {
    const response = await this.request('GET', '/me', pageToken, undefined, {
      fields: 'id,name',
    });
    return { id: String(response.id), name: String(response.name) };
  }

  /** Subscribes this app to the Page's webhook fields. */
  async subscribePage(
    pageId: string,
    pageToken: string,
    fields: string[],
  ): Promise<void> {
    await this.request(
      'POST',
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      pageToken,
      undefined,
      { subscribed_fields: fields.join(',') },
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    pageToken: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${GRAPH_BASE_URL}/${this.options.version}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('access_token', pageToken);
    if (this.options.appSecret) {
      url.searchParams.set(
        'appsecret_proof',
        createHmac('sha256', this.options.appSecret)
          .update(pageToken)
          .digest('hex'),
      );
    }

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(method, url, body);
      } catch (error) {
        if (!(error instanceof GraphError) || !error.transient || attempt > 0) {
          throw error;
        }
        this.logger.warn(`Graph API ${error.describe()}; retrying once`);
        await this.sleep(RETRY_DELAY_MS);
      }
    }
  }

  private async attempt(
    method: 'GET' | 'POST',
    url: URL,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetch(url, {
        method,
        headers:
          body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout,
      });
      text = await response.text();
    } catch (error) {
      // A timed-out send may still have been delivered, so it is not retried.
      throw new GraphError(
        timeout.aborted
          ? `no response within ${TIMEOUT_MS} ms`
          : `network error: ${error instanceof Error ? error.name : 'unknown'}`,
        undefined,
        undefined,
        undefined,
        undefined,
        !timeout.aborted,
      );
    }

    const parsed = safeJson(text);
    if (response.ok) return isRecord(parsed) ? parsed : {};

    const error =
      isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
    const code = typeof error.code === 'number' ? error.code : undefined;
    throw new GraphError(
      typeof error.message === 'string'
        ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
        : `HTTP ${response.status}`,
      response.status,
      code,
      typeof error.error_subcode === 'number' ? error.error_subcode : undefined,
      typeof error.fbtrace_id === 'string' ? error.fbtrace_id : undefined,
      response.status >= 500 ||
        error.is_transient === true ||
        (code !== undefined && TRANSIENT_CODES.has(code)),
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
