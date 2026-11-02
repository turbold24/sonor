import { safeEqual, signBody, verifySignature } from './signature.js';

const SECRET = 'app-secret';
const body = Buffer.from('{"object":"page","entry":[]}');

describe('verifySignature', () => {
  it('accepts a valid signature, in either hex case', () => {
    const header = signBody(body, SECRET);
    expect(verifySignature(body, header, SECRET)).toBe(true);
    expect(
      verifySignature(
        body,
        header.toUpperCase().replace('SHA256', 'sha256'),
        SECRET,
      ),
    ).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifySignature(body, signBody(body, 'other'), SECRET)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = signBody(body, SECRET);
    const tampered = Buffer.from('{"object":"page","entry":[{}]}');
    expect(verifySignature(tampered, header, SECRET)).toBe(false);
  });

  it('checks the raw bytes, not re-serialized JSON', () => {
    // Meta sends non-ASCII characters escaped; parsing and re-serializing changes the bytes.
    const raw = Buffer.from('{"text":"\\u0421\\u0430\\u0439\\u043d"}');
    const reserialized = Buffer.from(
      JSON.stringify(JSON.parse(raw.toString())),
    );
    const header = signBody(raw, SECRET);
    expect(verifySignature(raw, header, SECRET)).toBe(true);
    expect(verifySignature(reserialized, header, SECRET)).toBe(false);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['the old sha1 header format', 'sha1=abc'],
    ['a short digest', 'sha256=abcd'],
    ['non-hex characters', `sha256=${'z'.repeat(64)}`],
  ])('rejects %s', (_case, header) => {
    expect(verifySignature(body, header, SECRET)).toBe(false);
  });

  it('rejects everything when no secret or body is available', () => {
    const header = signBody(body, SECRET);
    expect(verifySignature(body, header, undefined)).toBe(false);
    expect(verifySignature(undefined, header, SECRET)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('token', 'token')).toBe(true);
    expect(safeEqual('token', 'tokem')).toBe(false);
    expect(safeEqual('token', 'token2')).toBe(false);
    expect(safeEqual(undefined, 'token')).toBe(false);
  });
});
