// Cross-script matching for Mongolian. Customers, and the model, write the same words
// in Cyrillic or informal Latin ("дээл" / "deel", "үнэ хэд вэ" / "une hed ve",
// "хүрэм" / "khurem" / "xurem"). Both reduce to one Latin key so search can compare them.
// The key is lossy on purpose and is only for matching, never for display.

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: 'i',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

// Applied to the Latin text from either script, so variants collapse to one spelling.
const LATIN_RULES: [RegExp, string][] = [
  [/kh/g, 'h'], // хэд: khed / hed
  [/x/g, 'h'], // хүрэм: xurem
  [/zh/g, 'j'], // ж
  [/w/g, 'v'],
  [/q/g, 'k'],
  [/c(?!h)/g, 'ts'], // цамц: camc / tsamts
  [/ye/g, 'e'], // ер: yer / er
  [/y(?![aou])/g, 'i'], // малгай: malgay / malgai; ы, й
  [/v(?![aeiou])/g, 'u'], // үнэ: vne (informal Latin uses v for ү)
  [/([aeiou])\1+/g, '$1'], // дээл: deel / del
];

/** Lowercase Latin key with words separated by single spaces. */
export function toLatinKey(text: string): string {
  let latin = '';
  for (const char of text.normalize('NFC').toLowerCase()) {
    latin += CYRILLIC_TO_LATIN[char] ?? char;
  }
  latin = latin
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // ö → o, ü → u
    .replace(/[^a-z0-9]+/g, ' ');
  for (const [pattern, replacement] of LATIN_RULES) {
    latin = latin.replace(pattern, replacement);
  }
  return latin.replace(/\s+/g, ' ').trim();
}

// Question and filler words that say nothing about which product is meant.
const STOP_WORDS = new Set(
  [
    'үнэ',
    'үнэтэй',
    'хэд',
    'вэ',
    'бэ',
    'байгаа',
    'байна',
    'бий',
    'юу',
    'уу',
    'үү',
    'ямар',
    'ийм',
    'энэ',
    'тэр',
    'танайд',
    'танай',
    'сайн',
    'надад',
    'авах',
    'авмаар',
    'bga',
    'bgaa',
    'bn',
    'bna',
    'yu',
  ].map(toLatinKey),
);

export function searchTokens(text: string): string[] {
  return toLatinKey(text)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export type Script = 'cyrillic' | 'latin';

/** The script most of the letters are in; Cyrillic when there are no letters. */
export function detectScript(text: string): Script {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return latin > cyrillic ? 'latin' : 'cyrillic';
}
