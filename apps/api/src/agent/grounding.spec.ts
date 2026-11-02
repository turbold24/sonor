import { extractPrices, numbersIn, ungroundedPrices } from './grounding.js';

describe('extractPrices', () => {
  it.each([
    ['Энэ дээл 285,000₮ байна.', [285000]],
    ['Үнэ нь 285 000 төгрөг.', [285000]],
    ['285.000₮', [285000]],
    ['₮59,000', [59000]],
    ['459000 төг', [459000]],
    ['Une ni 245,000 tugrug', [245000]],
    ['48 мянган төгрөг', [48000]],
    ['48 мянга', [48000]],
    ['48k', [48000]],
    ['1.2 сая', [1200000]],
    ['15000', [15000]],
    ['15000₮ ба 25,000₮', [15000, 25000]],
  ])('%s -> %j', (text, prices) => {
    expect(extractPrices(text)).toEqual(prices);
  });

  it.each([
    'SPF50 тос, 50 мл',
    'M, L, XL размертай, 42 ч байгаа',
    '-40°C хүйтэнд',
    '90% нугасны өд',
    '3-4 нас',
    'Даваа-Баасан 10:00-19:00',
    '7 хоногт 2-3 удаа',
  ])('ignores non-prices in "%s"', (text) => {
    expect(extractPrices(text)).toEqual([]);
  });
});

describe('ungroundedPrices', () => {
  const toolOutputs = [
    '{"results":[{"name":"Эрэгтэй богино дээл","price":245000,"availability":"in_stock"}]}',
  ];

  it('accepts prices that appear in tool results', () => {
    const allowed = numbersIn(toolOutputs);
    expect(ungroundedPrices('Энэ дээл 245,000₮ байна.', allowed)).toEqual([]);
    expect(ungroundedPrices('245 мянган төгрөг', allowed)).toEqual([]);
  });

  it('flags invented, discounted and summed prices', () => {
    const allowed = numbersIn(toolOutputs);
    expect(ungroundedPrices('Хямдралтай 199,000₮.', allowed)).toEqual([199000]);
    expect(ungroundedPrices('2 ширхэг нийт 490,000₮.', allowed)).toEqual([
      490000,
    ]);
  });

  it('flags any price when no tool ran', () => {
    expect(ungroundedPrices('Ойролцоогоор 300,000₮.', new Set())).toEqual([
      300000,
    ]);
  });
});
