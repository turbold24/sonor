import { detectScript, searchTokens, toLatinKey } from './mongolian-script.js';

describe('toLatinKey', () => {
  it.each([
    ['дээл', 'deel'],
    ['Дээл', 'DEEL'],
    ['үнэ хэд вэ', 'une hed ve'],
    ['үнэ хэд вэ', 'üne khed ve'],
    ['үнэ хэд вэ', 'vne hed ve'],
    ['хүрэм', 'khurem'],
    ['хүрэм', 'xurem'],
    ['цамц', 'tsamts'],
    ['цамц', 'camc'],
    ['ноолууран малгай', 'nooluuran malgai'],
    ['ноолууран малгай', 'noluuran malgay'],
    ['нүүрний тос', 'nuurnii tos'],
    ['нүүрний тос', 'nuurniy tos'],
    ['уруулын будаг', 'uruulyn budag'],
    ['чацарганы тос', 'chatsargany tos'],
    ['шампунь', 'shampuni'],
    ['хувцас', 'huvtsas'],
    ['жинс', 'zhins'],
    ['ёс', 'yos'],
    ['юм', 'yum'],
    ['ямар', 'yamar'],
    ['есөн', 'yeson'],
    ['өвлийн гутал', 'ovliin gutal'],
  ])('matches %s with %s', (cyrillic, latin) => {
    expect(toLatinKey(cyrillic)).toBe(toLatinKey(latin));
  });

  it('produces a compact Latin form', () => {
    // "в" before a consonant becomes "u" on both sides, so "ovl" -> "oul".
    expect(toLatinKey('Хурганы арьсан дотортой өвлийн дээл')).toBe(
      'hurgani arisan dotortoi oulin del',
    );
    expect(toLatinKey('Ноолууран малгай!')).toBe('noluran malgai');
  });

  it('keeps digits and drops punctuation', () => {
    expect(toLatinKey('SPF50, 50 мл')).toBe('spf50 50 ml');
    expect(toLatinKey('285,000₮')).toBe('285 000');
  });

  it('keeps distinct words apart', () => {
    expect(toLatinKey('малгай')).not.toBe(toLatinKey('гутал'));
    expect(toLatinKey('тос')).not.toBe(toLatinKey('маск'));
  });
});

describe('searchTokens', () => {
  it('drops question and filler words in both scripts', () => {
    expect(searchTokens('Дээл байгаа юу?')).toEqual(['del']);
    expect(searchTokens('deel bga yu')).toEqual(['del']);
    expect(searchTokens('Урт өдөн куртка үнэ хэд вэ')).toEqual([
      'urt',
      'odon',
      'kurtka',
    ]);
    expect(searchTokens('urt odon kurtka une hed ve')).toEqual([
      'urt',
      'odon',
      'kurtka',
    ]);
  });
});

describe('detectScript', () => {
  it.each([
    ['Сайн байна уу', 'cyrillic'],
    ['Sain baina uu', 'latin'],
    ['deel bga yu?', 'latin'],
    ['Сайн уу, nuurnii mask bga yu', 'latin'],
    ['SPF50 тос байгаа юу', 'cyrillic'],
    ['123', 'cyrillic'],
  ])('%s is %s', (text, script) => {
    expect(detectScript(text)).toBe(script);
  });
});
