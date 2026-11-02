// Exact stock counts never reach the model or the customer, only these labels.

export type Availability = 'in_stock' | 'few_left' | 'out_of_stock';

export const FEW_LEFT_MAX = 3;

export function availabilityOf(stock: number): Availability {
  if (stock <= 0) return 'out_of_stock';
  return stock <= FEW_LEFT_MAX ? 'few_left' : 'in_stock';
}

const STOCK_KEY =
  /^(stocks?|stock_?(count|level|qty|quantity|left)|qty|inventory|in_?stock_?(count|qty|quantity)|quantity_?(available|in_?stock|on_?hand|left)|available_?(qty|quantity|stock)|remaining(_?stock)?)$/i;

/** Replaces numeric stock-like fields anywhere in external data with availability labels. */
export function redactStockCounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStockCounts);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const count = typeof item === 'string' ? Number(item) : item;
      if (
        STOCK_KEY.test(key) &&
        typeof count === 'number' &&
        Number.isFinite(count)
      ) {
        return [key, availabilityOf(count)];
      }
      return [key, redactStockCounts(item)];
    }),
  );
}
