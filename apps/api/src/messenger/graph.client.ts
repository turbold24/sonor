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

export type MessagingType = 'RESPONSE' | 'UPDATE';

export interface UrlButton {
  url: string;
  /** At most 20 characters. */
  title: string;
}

const BUTTON_TEXT_LIMIT = 640;
const BUTTON_TITLE_LIMIT = 20;

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

export interface TokenInfo {
  valid: boolean;
  /** PAGE for a Page access token. */
  type?: string;
  appId?: string;
  /** The Page ID for a Page token. Not in Meta's documented example, so it may be missing. */
  profileId?: string;
  scopes: string[];
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

  /**
   * Sends text, split into parts of at most 2000 characters. RESPONSE answers a message;
   * UPDATE is a proactive message, e.g. after a payment. Both need the 24-hour window.
   */
  async sendText(
    pageToken: string,
    psid: string,
    text: string,
    messagingType: MessagingType = 'RESPONSE',
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const part of splitMessage(text)) {
      const response = await this.request('POST', '/me/messages', pageToken, {
        recipient: { id: psid },
        messaging_type: messagingType,
        message: { text: part, metadata: OWN_MESSAGE_METADATA },
      });
      if (typeof response.message_id === 'string') {
        ids.push(response.message_id);
      }
    }
    return ids;
  }

  /** A button template: up to 640 characters of text and 1-3 URL buttons. */
  async sendUrlButtons(
    pageToken: string,
    psid: string,
    text: string,
    buttons: UrlButton[],
    messagingType: MessagingType = 'RESPONSE',
  ): Promise<void> {
    await this.request('POST', '/me/messages', pageToken, {
      recipient: { id: psid },
      messaging_type: messagingType,
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: text.slice(0, BUTTON_TEXT_LIMIT),
            buttons: buttons.slice(0, 3).map((button) => ({
              type: 'web_url',
              url: button.url,
              title: button.title.slice(0, BUTTON_TITLE_LIMIT),
              // The page may show order details; hide the webview's share button.
              webview_share_button: 'hide',
            })),
          },
        },
        metadata: OWN_MESSAGE_METADATA,
      },
    });
  }

  /**
   * What Meta knows about a token, from GET /debug_token, inspecting the token with itself.
   * Unlike reading /me, this needs no pages_read_engagement permission.
   */
  async tokenInfo(pageToken: string): Promise<TokenInfo> {
    const response = await this.request(
      'GET',
      '/debug_token',
      pageToken,
      undefined,
      { input_token: pageToken },
    );
    const data =
      typeof response.data === 'object' && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    const text = (value: unknown) =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;
    return {
      valid: data.is_valid === true,
      type: text(data.type),
      appId: text(data.app_id),
      profileId: text(data.profile_id),
      scopes: Array.isArray(data.scopes)
        ? data.scopes.filter((scope) => typeof scope === 'string')
        : [],
    };
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
