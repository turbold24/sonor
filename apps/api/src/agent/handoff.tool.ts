import type { ToolDefinition } from '../model/model.types.js';

export const HANDOFF_TOOL_NAME = 'request_handoff';

/** Built in for every tenant; executed by the agent itself, not a connector. */
export const HANDOFF_TOOL: ToolDefinition = {
  name: HANDOFF_TOOL_NAME,
  description:
    'Hand this conversation to a human staff member. Use when the customer asks for a person, has a complaint or payment or delivery problem, or asks something the tools and business info cannot answer. Pauses the assistant for this conversation and returns the contact info to share.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Short reason, for the staff member.',
      },
    },
    required: [],
    additionalProperties: false,
  },
};
