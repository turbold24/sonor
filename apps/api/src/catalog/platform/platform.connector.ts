import { Logger } from '@nestjs/common';
import { decryptSecret } from '../../common/encryption.js';
import type { Tenant } from '../../generated/prisma/client.js';
import type { JsonSchema, ToolDefinition } from '../../model/model.types.js';
import { toolError, type CatalogConnector } from '../catalog.types.js';
import { redactStockCounts } from '../stock-policy.js';

// Thin proxy to the owner's platform integration API:
//   GET  {base}/integrations/v1/tools        -> [{ name, description, parameters }] or { tools: [...] }
//   POST {base}/integrations/v1/tools/:name  body { arguments } -> any JSON
//   GET  {base}/integrations/v1/brief        -> { brief } or plain text
// Auth is "Authorization: Bearer <api key>". Everything the platform returns is untrusted
// data: tool lists are validated and capped, results only ever go back to the model as
// tool output, and the brief sits in a fenced data block of the system prompt.

const CACHE_MS = 5 * 60_000;
const MAX_TOOLS = 20;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_BODY_CHARS = 64_000;
const MAX_BRIEF_CHARS = 2000;
// Model API rule: letters, digits, _ . - and at most one dot.
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}(\.[a-zA-Z0-9_-]{1,64})?$/;
// Built in to the agent; a platform tool can't shadow them.
const RESERVED_TOOL_NAMES = new Set(['request_handoff']);

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export interface PlatformConnectorOptions {
  timeoutMs: number;
  /** Read lazily so the app boots without ENCRYPTION_KEY until a PLATFORM tenant is used. */
  encryptionKey: () => Buffer;
}

export interface PlatformConnectorDeps {
  fetch?: typeof fetch;
  now?: () => number;
  logger?: Pick<Logger, 'warn'>;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

export class PlatformConnector implements CatalogConnector {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly toolCache = new Map<string, Cached<ToolDefinition[]>>();
  private readonly briefCache = new Map<string, Cached<string | null>>();

  constructor(
    private readonly options: PlatformConnectorOptions,
    deps: PlatformConnectorDeps = {},
  ) {
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? new Logger(PlatformConnector.name);
  }

  /** Throws PlatformError if the platform is unreachable or misconfigured. */
  async tools(tenant: Tenant): Promise<ToolDefinition[]> {
    return this.cached(this.toolCache, tenant.id, async () => {
      const body = await this.request(tenant, 'GET', '/integrations/v1/tools');
      return this.parseTools(body);
    });
  }

  async execute(
    tenant: Tenant,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const known = await this.tools(tenant);
      if (!known.some((tool) => tool.name === name)) {
        return toolError('unknown_tool', `No tool named ${name}.`);
      }
      const body = await this.request(
        tenant,
        'POST',
        `/integrations/v1/tools/${encodeURIComponent(name)}`,
        { arguments: args },
      );
      return redactStockCounts(body);
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      return toolError(
        error.status ? 'platform_error' : 'platform_unavailable',
        error.message,
      );
    }
  }

  async brief(tenant: Tenant): Promise<string | null> {
    return this.cached(this.briefCache, tenant.id, async () => {
      const body = await this.request(tenant, 'GET', '/integrations/v1/brief');
      const text =
        typeof body === 'string'
          ? body
          : isRecord(body) && typeof body.brief === 'string'
            ? body.brief
            : null;
      return text?.trim() ? text.trim().slice(0, MAX_BRIEF_CHARS) : null;
    });
  }

  private async cached<T>(
    cache: Map<string, Cached<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const value = await load();
    cache.set(key, { value, expiresAt: this.now() + CACHE_MS });
    return value;
  }

  private async request(
    tenant: Tenant,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const { baseUrl, apiKey } = this.connection(tenant);
    const timeout = AbortSignal.timeout(this.options.timeoutMs);

    let response: Response;
    let text: string;
    try {
      response = await this.fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: timeout,
      });
      text = await response.text();
    } catch (error) {
      throw new PlatformError(
        timeout.aborted
          ? `Platform did not respond within ${this.options.timeoutMs} ms`
          : `Could not reach the platform: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new PlatformError(
        `Platform returned HTTP ${response.status}`,
        response.status,
      );
    }
    if (text.length > MAX_BODY_CHARS) {
      throw new PlatformError('Platform response is too large');
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private connection(tenant: Tenant): { baseUrl: string; apiKey: string } {
    if (!tenant.platformBaseUrl || !tenant.platformApiKeyEncrypted) {
      throw new PlatformError('Tenant has no platform URL or API key');
    }
    let url: URL;
    try {
      url = new URL(tenant.platformBaseUrl);
    } catch {
      throw new PlatformError('Tenant platform URL is invalid');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new PlatformError('Tenant platform URL must be http(s)');
    }
    return {
      baseUrl: url.href.replace(/\/+$/, ''),
      apiKey: decryptSecret(
        tenant.platformApiKeyEncrypted,
        this.options.encryptionKey(),
      ),
    };
  }

  private parseTools(body: unknown): ToolDefinition[] {
    const items: unknown[] = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.tools)
        ? body.tools
        : [];
    const tools: ToolDefinition[] = [];
    let skipped = 0;

    for (const item of items) {
      const name = isRecord(item) ? item.name : undefined;
      if (
        !isRecord(item) ||
        typeof name !== 'string' ||
        !TOOL_NAME.test(name) ||
        RESERVED_TOOL_NAMES.has(name) ||
        tools.some((tool) => tool.name === name) ||
        tools.length >= MAX_TOOLS
      ) {
        skipped++;
        continue;
      }
      tools.push({
        name,
        description:
          typeof item.description === 'string'
            ? item.description.slice(0, MAX_DESCRIPTION_CHARS)
            : '',
        parameters: objectSchema(item.parameters),
      });
    }

    if (skipped > 0) {
      this.logger.warn(`Skipped ${skipped} invalid platform tool definitions`);
    }
    return tools;
  }
}

function objectSchema(value: unknown): JsonSchema {
  if (
    isRecord(value) &&
    (value.type === undefined || value.type === 'object')
  ) {
    return { ...value, type: 'object' };
  }
  return { type: 'object', properties: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
