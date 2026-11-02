import { availabilityOf, redactStockCounts } from './stock-policy.js';

describe('availabilityOf', () => {
  it.each([
    [-1, 'out_of_stock'],
    [0, 'out_of_stock'],
    [1, 'few_left'],
    [3, 'few_left'],
    [4, 'in_stock'],
    [120, 'in_stock'],
  ])('%i -> %s', (stock, label) => {
    expect(availabilityOf(stock)).toBe(label);
  });
});

describe('redactStockCounts', () => {
  it('replaces stock-like numbers at any depth and leaves the rest', () => {
    expect(
      redactStockCounts({
        items: [
          { name: 'Дээл', price: 285000, stock: 8 },
          { name: 'Малгай', price: 59000, stockCount: '2' },
          { name: 'Гутал', variants: [{ size: '42', quantityAvailable: 0 }] },
        ],
        inventory: 40,
        quantity: 2,
        inStock: true,
      }),
    ).toEqual({
      items: [
        { name: 'Дээл', price: 285000, stock: 'in_stock' },
        { name: 'Малгай', price: 59000, stockCount: 'few_left' },
        {
          name: 'Гутал',
          variants: [{ size: '42', quantityAvailable: 'out_of_stock' }],
        },
      ],
      inventory: 'in_stock',
      quantity: 2,
      inStock: true,
    });
  });

  it('passes primitives through', () => {
    expect(redactStockCounts('text')).toBe('text');
    expect(redactStockCounts(null)).toBeNull();
  });
});
