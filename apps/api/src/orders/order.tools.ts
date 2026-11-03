import type { ToolDefinition } from '../model/model.types.js';
import { MAX_QUANTITY } from './order-lines.js';

export const CREATE_ORDER = 'create_order';
export const CONFIRM_ORDER = 'confirm_order';
export const CANCEL_ORDER = 'cancel_order';

export const ORDER_TOOL_NAMES = new Set([
  CREATE_ORDER,
  CONFIRM_ORDER,
  CANCEL_ORDER,
]);

/** Built in for DEMO tenants, whose catalog lives in Sonor; run by OrderService. */
export const ORDER_TOOLS: ToolDefinition[] = [
  {
    name: CREATE_ORDER,
    description: `Draft an order for this chat when the customer wants to buy. Prices and the total come from the catalog. Replaces any unpaid order in this chat. It checks stock, sizes and colors itself, so call it as soon as you know the productId; no need to check availability first. Sizes and colors must be chosen when the product offers several. Returns the items, total and orderCode, or problems to ask the customer about. Up to ${MAX_QUANTITY} of each item.`,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'What the customer wants to buy.',
          items: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                description: 'productId from search.',
              },
              quantity: {
                type: 'integer',
                description: 'How many, 1 or more.',
              },
              size: {
                type: 'string',
                description: 'Chosen size, if the product has sizes.',
              },
              color: {
                type: 'string',
                description: 'Chosen color or shade, if the product has them.',
              },
            },
            required: ['productId', 'quantity'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: CONFIRM_ORDER,
    description:
      "Confirm this chat's draft order, only after the customer has clearly agreed to the items and total. Creates a payment link that Sonor sends to the customer as a button after your reply; never write a URL yourself. Delivery address and phone are entered on the payment page.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: CANCEL_ORDER,
    description:
      "Cancel this chat's unpaid order when the customer no longer wants it.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];
