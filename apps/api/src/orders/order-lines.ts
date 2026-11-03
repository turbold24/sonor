import { attributeValues, matchOption } from '../catalog/product-search.js';
import { availabilityOf } from '../catalog/stock-policy.js';

// Turns the model's order request into priced lines. Prices and stock come from the
// catalog rows, never from the model; problems come back per item so the model can ask.

export const MAX_QUANTITY = 20;

export interface OrderableProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  attributes: unknown;
}

export interface RequestedItem {
  productId: string;
  quantity: number;
  size?: string;
  color?: string;
}

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  options: { size?: string; color?: string };
}

export type LineProblem =
  | 'not_found'
  | 'bad_quantity'
  | 'out_of_stock'
  | 'not_enough_stock'
  | 'size_required'
  | 'size_not_offered'
  | 'color_required'
  | 'color_not_offered';

export interface ItemProblem {
  productId: string;
  name?: string;
  problem: LineProblem;
  /** The choices to offer for a missing or unknown size or color. */
  choices?: string[];
}

export type PricedOrder =
  | { ok: true; lines: PricedLine[]; total: number }
  | { ok: false; problems: ItemProblem[] };

/** Reads loosely typed tool arguments into item requests; null if unusable. */
export function parseItems(value: unknown): RequestedItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: RequestedItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const productId = text(item.productId);
    const quantity = Number(item.quantity ?? 1);
    if (!productId) return null;
    items.push({
      productId,
      quantity,
      size: text(item.size),
      color: text(item.color),
    });
  }
  return items;
}

export function priceOrder(
  products: OrderableProduct[],
  items: RequestedItem[],
): PricedOrder {
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: PricedLine[] = [];
  const problems: ItemProblem[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      problems.push({ productId: item.productId, problem: 'not_found' });
      continue;
    }
    const issue = (problem: LineProblem, choices?: string[]) =>
      problems.push({
        productId: product.id,
        name: product.name,
        problem,
        choices,
      });

    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY
    ) {
      issue('bad_quantity');
      continue;
    }
    if (availabilityOf(product.stock) === 'out_of_stock') {
      issue('out_of_stock');
      continue;
    }
    if (item.quantity > product.stock) {
      issue('not_enough_stock');
      continue;
    }

    const attributes = isRecord(product.attributes) ? product.attributes : {};
    const size = chooseOption(item.size, attributes.sizes);
    if (size.problem) {
      issue(`size_${size.problem}`, attributeValues(attributes.sizes));
      continue;
    }
    const colors = [attributes.colors, attributes.shades];
    const color = chooseOption(item.color, colors);
    if (color.problem) {
      issue(`color_${color.problem}`, attributeValues(colors));
      continue;
    }

    lines.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: product.price,
      lineTotal: product.price * item.quantity,
      options: {
        ...(size.value ? { size: size.value } : {}),
        ...(color.value ? { color: color.value } : {}),
      },
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    lines,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
  };
}

/**
 * A product with several sizes (or colors) needs one chosen; with exactly one, it is
 * picked for the customer; with none, nothing is recorded.
 */
function chooseOption(
  wanted: string | undefined,
  offered: unknown,
): { value?: string; problem?: 'required' | 'not_offered' } {
  const options = attributeValues(offered);
  if (options.length === 0) return {};
  if (!wanted) {
    return options.length === 1
      ? { value: options[0] }
      : { problem: 'required' };
  }
  const match = matchOption(wanted, offered);
  return match ? { value: match } : { problem: 'not_offered' };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
