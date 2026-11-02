import { splitMessage } from './message-split.js';

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('splitMessage', () => {
  it('keeps short replies whole', () => {
    expect(splitMessage('Сайн байна уу!')).toEqual(['Сайн байна уу!']);
    expect(splitMessage('x'.repeat(2000))).toHaveLength(1);
  });

  it('splits at a paragraph break when there is one', () => {
    const text = `${'А'.repeat(1500)}\n\n${'Б'.repeat(1000)}`;
    expect(splitMessage(text)).toEqual(['А'.repeat(1500), 'Б'.repeat(1000)]);
  });

  it('splits Mongolian sentences without breaking words, all within 2000', () => {
    const sentence = 'Энэ дээл 285,000₮ бөгөөд одоо байгаа. ';
    const text = sentence.repeat(120);
    const parts = splitMessage(text);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 2000)).toBe(true);
    expect(parts.every((part) => part.endsWith('.'))).toBe(true);
    expect(squash(parts.join(' '))).toBe(squash(text));
  });

  it('hard-splits text without any breaks', () => {
    const parts = splitMessage('x'.repeat(4500));
    expect(parts.map((part) => part.length)).toEqual([2000, 2000, 500]);
  });

  it('respects a custom limit', () => {
    expect(splitMessage('one two three four', 9)).toEqual([
      'one two',
      'three',
      'four',
    ]);
  });
});
