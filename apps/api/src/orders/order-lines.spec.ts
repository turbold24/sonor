import {
  MAX_QUANTITY,
  parseItems,
  priceOrder,
  type OrderableProduct,
} from './order-lines.js';

const hat: OrderableProduct = {
  id: 'hat',
  name: 'Ноолууран малгай',
  price: 59000,
  stock: 10,
  attributes: { sizes: ['нэг хэмжээ'], colors: ['саарал', 'хар'] },
};
const deel: OrderableProduct = {
  id: 'deel',
  name: 'Эрэгтэй богино дээл',
  price: 285000,
  stock: 2,
  attributes: { sizes: ['M', 'L'], colors: ['хар'] },
};
const boots: OrderableProduct = {
  id: 'boots',
  name: 'Монгол гутал',
  price: 380000,
  stock: 0,
  attributes: { sizes: ['42'] },
};
const lipstick: OrderableProduct = {
  id: 'lip',
  name: 'Уруулын будаг',
  price: 32000,
  stock: 5,
  attributes: { shades: ['01 Улаан', '02 Шаргал ягаан'] },
};
const catalog = [hat, deel, boots, lipstick];

describe('priceOrder', () => {
  it('prices lines from the catalog and matches options across scripts', () => {
    const result = priceOrder(catalog, [
      { productId: 'hat', quantity: 2, color: 'har' },
      { productId: 'deel', quantity: 1, size: 'l' },
    ]);
    expect(result).toEqual({
      ok: true,
      total: 2 * 59000 + 285000,
      lines: [
        {
          productId: 'hat',
          name: 'Ноолууран малгай',
          quantity: 2,
          unitPrice: 59000,
          lineTotal: 118000,
          // The only size is chosen for the customer; the color in catalog spelling.
          options: { size: 'нэг хэмжээ', color: 'хар' },
        },
        {
          productId: 'deel',
          name: 'Эрэгтэй богино дээл',
          quantity: 1,
          unitPrice: 285000,
          lineTotal: 285000,
          options: { size: 'L', color: 'хар' },
        },
      ],
    });
  });

  it('treats shades as colors', () => {
    const result = priceOrder(catalog, [
      { productId: 'lip', quantity: 1, color: '02 shargal yagaan' },
    ]);
    expect(result.ok && result.lines[0].options).toEqual({
      color: '02 Шаргал ягаан',
    });
  });

  it('asks for a size or color when there are several to choose from', () => {
    expect(priceOrder(catalog, [{ productId: 'deel', quantity: 1 }])).toEqual({
      ok: false,
      problems: [
        {
          productId: 'deel',
          name: 'Эрэгтэй богино дээл',
          problem: 'size_required',
          choices: ['M', 'L'],
        },
      ],
    });
    expect(
      priceOrder(catalog, [{ productId: 'hat', quantity: 1 }]),
    ).toMatchObject({
      ok: false,
      problems: [{ problem: 'color_required', choices: ['саарал', 'хар'] }],
    });
  });

  it('rejects options the product does not offer', () => {
    expect(
      priceOrder(catalog, [{ productId: 'hat', quantity: 1, color: 'улаан' }]),
    ).toMatchObject({
      ok: false,
      problems: [{ problem: 'color_not_offered', choices: ['саарал', 'хар'] }],
    });
    expect(
      priceOrder(catalog, [
        { productId: 'deel', quantity: 1, size: 'XS', color: 'хар' },
      ]),
    ).toMatchObject({ ok: false, problems: [{ problem: 'size_not_offered' }] });
  });

  it('refuses sold-out items and quantities above the stock without saying the count', () => {
    const result = priceOrder(catalog, [
      { productId: 'boots', quantity: 1 },
      { productId: 'deel', quantity: 3, size: 'M' },
    ]);
    expect(result).toMatchObject({
      ok: false,
      problems: [
        { productId: 'boots', problem: 'out_of_stock' },
        { productId: 'deel', problem: 'not_enough_stock' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/"stock"/);
  });

  it('rejects unknown products and bad quantities', () => {
    expect(
      priceOrder(catalog, [
        { productId: 'nope', quantity: 1 },
        { productId: 'hat', quantity: 0, color: 'хар' },
        { productId: 'hat', quantity: 1.5, color: 'хар' },
        { productId: 'hat', quantity: MAX_QUANTITY + 1, color: 'хар' },
      ]),
    ).toMatchObject({
      ok: false,
      problems: [
        { productId: 'nope', problem: 'not_found' },
        { problem: 'bad_quantity' },
        { problem: 'bad_quantity' },
        { problem: 'bad_quantity' },
      ],
    });
  });
});

describe('parseItems', () => {
  it('reads items, defaulting the quantity to 1', () => {
    expect(
      parseItems([
        { productId: ' hat ', color: 'хар' },
        { productId: 'deel', quantity: '2', size: 'M' },
      ]),
    ).toEqual([
      { productId: 'hat', quantity: 1, size: undefined, color: 'хар' },
      { productId: 'deel', quantity: 2, size: 'M', color: undefined },
    ]);
  });

  it.each([[[]], ['hat'], [[{ quantity: 1 }]], [[null]], [undefined]])(
    'refuses %o',
    (value) => {
      expect(parseItems(value)).toBeNull();
    },
  );
});
