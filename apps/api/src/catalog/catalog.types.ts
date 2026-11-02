import type { Tenant } from '../generated/prisma/client.js';
import type { ToolDefinition } from '../model/model.types.js';

// A connector gives the agent a tenant's tools. Results are data for the model, never
// instructions, and tool-level problems come back as { error } results rather than throws.
export interface CatalogConnector {
  tools(tenant: Tenant): Promise<ToolDefinition[]>;
  execute(
    tenant: Tenant,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  /** Short business summary for the system prompt, or null if there is none. */
  brief(tenant: Tenant): Promise<string | null>;
}

export interface ToolErrorResult {
  error: string;
  message: string;
}

export function toolError(error: string, message: string): ToolErrorResult {
  return { error, message };
}
