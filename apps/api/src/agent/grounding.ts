// Grounding check: every price in a reply must appear in this turn's tool results.
// A number counts as a price if it has a currency or thousands word next to it
// (₮, төг, MNT, мянга, k, сая) or is 1,000 or more.

const NUMBER = String.raw`\d{1,3}(?:[ ,.'’]\d{3})+(?!\d)|\d+(?:[.,]\d+)?`;
const UNIT = String.raw`₮|төгрөг\p{L}*|төг(?!\p{L})|tugrug\w*|tögrög\w*|togrog\w*|tog(?![a-z])|mnt(?![a-z])|мянга\p{L}*|myanga\w*|myang\w*|k(?![a-z])|сая\p{L}*|saya\w*`;
const PRICE = new RegExp(
  String.raw`(?<![\p{L}\d])(₮\s?)?(${NUMBER})(?:\s?(${UNIT}))?`,
  'giu',
);

export function extractPrices(text: string): number[] {
  const prices: number[] = [];
  for (const [, prefix, raw, unit] of text.matchAll(PRICE)) {
    const multiplier = unitMultiplier(unit);
    const value = Math.round(parseNumber(raw) * multiplier);
    if (prefix || unit || value >= 1000) prices.push(value);
  }
  return prices;
}

/** Every number that appears in the given texts, e.g. serialized tool results. */
export function numbersIn(texts: string[]): Set<number> {
  const numbers = new Set<number>();
  for (const text of texts) {
    for (const [raw] of text.matchAll(/\d+(?:\.\d+)?/g)) {
      numbers.add(Number(raw));
    }
  }
  return numbers;
}

export function ungroundedPrices(
  reply: string,
  allowed: Set<number>,
): number[] {
  return [...new Set(extractPrices(reply))].filter(
    (price) => !allowed.has(price),
  );
}

function unitMultiplier(unit: string | undefined): number {
  if (!unit) return 1;
  const lower = unit.toLowerCase();
  if (/^(мянга|myang|k$)/u.test(lower)) return 1000;
  if (/^(сая|saya)/u.test(lower)) return 1_000_000;
  return 1;
}

function parseNumber(raw: string): number {
  // Grouped thousands: "285,000", "285 000", "285.000".
  if (/^\d{1,3}(?:[ ,.'’]\d{3})+$/.test(raw)) {
    return Number(raw.replace(/[^\d]/g, ''));
  }
  return Number(raw.replace(',', '.'));
}
