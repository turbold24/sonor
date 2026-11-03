import {
  DISCLOSURE_LAPSE_MS,
  disclosureNote,
  needsDisclosure,
  withDisclosure,
} from './disclosure.js';

const now = new Date('2026-11-03T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const MINUTE = 60_000;

describe('needsDisclosure', () => {
  it('discloses on the first bot reply in a chat', () => {
    expect(needsDisclosure([], now)).toBe(true);
    expect(
      needsDisclosure([{ role: 'OWNER', createdAt: ago(MINUTE) }], now),
    ).toBe(true);
  });

  it('stays quiet while the bot keeps talking', () => {
    expect(
      needsDisclosure([{ role: 'AGENT', createdAt: ago(5 * MINUTE) }], now),
    ).toBe(false);
  });

  it('discloses again after a long lapse', () => {
    expect(
      needsDisclosure(
        [{ role: 'AGENT', createdAt: ago(DISCLOSURE_LAPSE_MS + MINUTE) }],
        now,
      ),
    ).toBe(true);
  });

  it('discloses again when the bot takes over from a person', () => {
    expect(
      needsDisclosure(
        [
          { role: 'OWNER', createdAt: ago(2 * MINUTE) },
          { role: 'AGENT', createdAt: ago(10 * MINUTE) },
        ],
        now,
      ),
    ).toBe(true);
    // Owner messages from before the bot's last reply don't count.
    expect(
      needsDisclosure(
        [
          { role: 'AGENT', createdAt: ago(2 * MINUTE) },
          { role: 'OWNER', createdAt: ago(10 * MINUTE) },
        ],
        now,
      ),
    ).toBe(false);
  });
});

describe('disclosure note', () => {
  it('says it is a bot in the customer’s script, without naming the model', () => {
    expect(disclosureNote('cyrillic')).toMatch(/автомат туслах \(бот\)/);
    expect(disclosureNote('latin')).toMatch(/avtomat tuslah \(bot\)/);
    for (const script of ['cyrillic', 'latin'] as const) {
      expect(disclosureNote(script)).not.toMatch(/muse|spark|meta|llama/i);
    }
  });

  it('goes after the reply as its own paragraph', () => {
    expect(withDisclosure('Sain baina uu!', 'latin')).toBe(
      'Sain baina uu!\n\nBi avtomat tuslah (bot). Ajiltantai yarih bol heleerei.',
    );
  });
});
