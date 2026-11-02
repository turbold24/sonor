import type { JsonSchema } from '../model/model.types.js';

export type ToolArgsResult =
  { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/**
 * Checks model-produced arguments against the subset of JSON Schema our tools use:
 * required keys, primitive types and enums. Numeric strings are coerced for number
 * fields, and keys the schema doesn't declare are dropped when it disallows extras.
 */
export function validateToolArgs(
  schema: JsonSchema,
  args: Record<string, unknown> | null,
): ToolArgsResult {
  if (!args) return { ok: false, error: 'Arguments must be a JSON object.' };

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const output: Record<string, unknown> = {};

  for (const key of required) {
    if (
      typeof key === 'string' &&
      (args[key] === undefined || args[key] === null)
    ) {
      return { ok: false, error: `Missing required argument "${key}".` };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!isRecord(property)) {
      if (schema.additionalProperties !== false) output[key] = value;
      continue;
    }
    if (value === null || value === undefined) continue;

    const coerced = coerce(property.type, value);
    if (coerced === undefined) {
      return {
        ok: false,
        error: `Argument "${key}" must be of type ${String(property.type)}.`,
      };
    }
    if (Array.isArray(property.enum) && !property.enum.includes(coerced)) {
      return {
        ok: false,
        error: `Argument "${key}" must be one of: ${property.enum.join(', ')}.`,
      };
    }
    output[key] = coerced;
  }

  return { ok: true, args: output };
}

function coerce(type: unknown, value: unknown): unknown {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'integer':
    case 'number': {
      const number =
        typeof value === 'string' && value.trim() !== ''
          ? Number(value.replace(/[\s,₮]/g, ''))
          : value;
      if (typeof number !== 'number' || !Number.isFinite(number))
        return undefined;
      return type === 'integer' && !Number.isInteger(number)
        ? undefined
        : number;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'array':
      return Array.isArray(value) ? value : undefined;
    case 'object':
      return isRecord(value) ? value : undefined;
    default:
      return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
