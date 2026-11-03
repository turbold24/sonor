import {
  chatCode,
  handoffAlert,
  hashLinkCode,
  linkCodeIn,
  newLinkCode,
  paidOrderAlert,
  parseOwnerCommand,
} from './owner-messages.js';

describe('owner link codes', () => {
  it('makes unambiguous SONOR- codes', () => {
    const codes = new Set(Array.from({ length: 50 }, newLinkCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^SONOR-[A-HJ-NP-Z2-9]{6}$/);
  });

  it('accepts a code with stray spaces or lowercase, and nothing else', () => {
    expect(linkCodeIn('  sonor-k3f9q2 ')).toBe('SONOR-K3F9Q2');
    expect(linkCodeIn('SONOR-K3F9Q2 please')).toBeNull();
    expect(linkCodeIn('deel bga yu?')).toBeNull();
  });

  it('hashes codes so only the hash is stored', () => {
    expect(hashLinkCode('SONOR-K3F9Q2')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkCode('SONOR-K3F9Q2')).not.toBe(hashLinkCode('SONOR-K3F9Q3'));
  });
});

describe('parseOwnerCommand', () => {
  it.each([
    ['/resume k3f9q2', { kind: 'resume', code: 'K3F9Q2' }],
    ['/resume #K3F9Q2', { kind: 'resume', code: 'K3F9Q2' }],
    ['/асаа K3F9Q2', { kind: 'resume', code: 'K3F9Q2' }],
    ['/resume', { kind: 'help' }],
    ['/help', { kind: 'help' }],
    ['/whatever', { kind: 'help' }],
  ])('%s', (text, command) => {
    expect(parseOwnerCommand(text)).toEqual(command);
  });

  it('leaves ordinary messages to the bot', () => {
    expect(parseOwnerCommand('nooluuran malgai baigaa yu?')).toBeNull();
    expect(parseOwnerCommand('1/2 size bga yu')).toBeNull();
  });
});

describe('owner alerts', () => {
  it('describes a handoff with the chat code, reason and last message', () => {
    const text = handoffAlert({
      chatCode: chatCode('cmw0hu1fh0001gwyl7o79lhud'),
      reason: 'Delivery question, no delivery info',
      lastMessage: 'hed honogt\nhurgedeg ve?',
      pauseHours: 12,
    });
    expect(text).toContain('чат #79LHUD');
    expect(text).toContain('Шалтгаан: Delivery question, no delivery info');
    expect(text).toContain('Сүүлийн мессеж: "hed honogt hurgedeg ve?"');
    expect(text).toContain('/resume 79LHUD');
    expect(text).toContain('12 цаг');
  });

  it('clips long customer text', () => {
    const text = handoffAlert({
      chatCode: 'ABC123',
      lastMessage: 'x'.repeat(1000),
      pauseHours: 12,
    });
    expect(text).toMatch(/"x{299}…"/);
  });

  it('lists a paid order with its items and contact details', () => {
    expect(
      paidOrderAlert({
        orderCode: 'VFZ1BB',
        total: 118000,
        items: [
          {
            name: 'Ноолууран малгай',
            options: ['нэг хэмжээ', 'хар'],
            quantity: 2,
          },
        ],
        phone: '99112233',
        address: 'Туршилтын хаяг 1',
      }),
    ).toBe(
      [
        '🛒 Төлбөр төлөгдсөн захиалга #VFZ1BB: 118,000₮',
        '• Ноолууран малгай (нэг хэмжээ, хар) × 2',
        'Утас: 99112233',
        'Хаяг: Туршилтын хаяг 1',
      ].join('\n'),
    );
  });
});
