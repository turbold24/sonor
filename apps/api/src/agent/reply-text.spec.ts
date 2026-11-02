import { hasMarkdown, stripMarkdown } from './reply-text.js';

describe('stripMarkdown', () => {
  it.each([
    [
      'Улаанбаатарт **цэлмэг**, **-18°C** байна.',
      'Улаанбаатарт цэлмэг, -18°C байна.',
    ],
    ['Үнэ: __285,000₮__', 'Үнэ: 285,000₮'],
    ['Энэ *шинэ* загвар.', 'Энэ шинэ загвар.'],
    ['## Дээл\nБайгаа.', 'Дээл\nБайгаа.'],
    ['- Хар\n- Бор', '• Хар\n• Бор'],
    ['* Хар\n* Бор', '• Хар\n• Бор'],
    ['Код: `SALE`', 'Код: SALE'],
    [
      '[Манай хуудас](https://example.com)',
      'Манай хуудас (https://example.com)',
    ],
    ['> ишлэл', 'ишлэл'],
    ['Мөр 1\n\n\n\nМөр 2', 'Мөр 1\n\nМөр 2'],
  ])('%j -> %j', (input, output) => {
    expect(stripMarkdown(input)).toBe(output);
  });

  it('leaves plain text, prices and math alone', () => {
    const plain = 'Эрэгтэй богино дээл 245,000₮, M-XXL размертай. 2*3 биш.';
    expect(stripMarkdown(plain)).toBe(plain);
  });

  it('leaves nothing hasMarkdown would flag', () => {
    const messy =
      '# Гарчиг\n**Тод** ба `код`\n- нэг\n- хоёр\n[линк](https://x.y)';
    expect(hasMarkdown(messy)).toBe(true);
    expect(hasMarkdown(stripMarkdown(messy))).toBe(false);
  });
});
