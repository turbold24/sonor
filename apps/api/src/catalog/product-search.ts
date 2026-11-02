import { searchTokens, toLatinKey } from '../common/mongolian-script.js';

export interface SearchableProduct {
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  attributes: unknown;
}

export interface ProductQuery {
  query: string;
  category?: string;
  maxPrice?: number;
}

// How much a query word counts when it matches each field.
const WEIGHTS = { name: 3, category: 2, attributes: 1, description: 1 };

/**
 * Ranks products against a query in either script. A query word matches a product word
 * if one is a prefix of the other (3+ letters), which covers Mongolian suffixes such as
 * "дээлийн" or "малгайг", or if longer words differ only in the last letter of the
 * shorter one ("чацаргана" / "чацарганы").
 */
export function rankProducts<T extends SearchableProduct>(
  products: T[],
  { query, category, maxPrice }: ProductQuery,
  limit = 5,
): T[] {
  const queryTokens = searchTokens(query);
  const categoryTokens = category ? searchTokens(category) : [];

  return products
    .filter((product) => maxPrice === undefined || product.price <= maxPrice)
    .filter(
      (product) =>
        categoryTokens.length === 0 ||
        anyMatch(categoryTokens, searchTokens(product.category ?? '')),
    )
    .map((product) => ({ product, score: score(product, queryTokens) }))
    .filter(({ score }) => queryTokens.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
    .slice(0, limit)
    .map(({ product }) => product);
}

function score(product: SearchableProduct, queryTokens: string[]): number {
  const fields: [number, string[]][] = [
    [WEIGHTS.name, searchTokens(product.name)],
    [WEIGHTS.category, searchTokens(product.category ?? '')],
    [WEIGHTS.attributes, attributeValues(product.attributes).flatMap(tokens)],
    [WEIGHTS.description, searchTokens(product.description ?? '')],
  ];

  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const [weight, productTokens] of fields) {
      if (weight > best && productTokens.some((t) => matches(queryToken, t))) {
        best = weight;
      }
    }
    total += best;
  }
  return total;
}

function tokens(text: string): string[] {
  return toLatinKey(text).split(' ').filter(Boolean);
}

function matches(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 3) return false;
  let common = 0;
  while (common < shorter && a[common] === b[common]) common++;
  return common === shorter || (shorter >= 5 && common >= shorter - 1);
}

function anyMatch(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => matches(x, y)));
}

/** All string and number leaves of a product's attributes, e.g. sizes and colors. */
export function attributeValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(attributeValues);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(attributeValues);
  }
  return [];
}

/** Whether `wanted` is one of the offered options, comparing across scripts. */
export function isOffered(wanted: string, offered: unknown): boolean {
  const key = toLatinKey(wanted);
  return attributeValues(offered).some((option) => toLatinKey(option) === key);
}
