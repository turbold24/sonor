import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from './encryption.js';

describe('encryption', () => {
  const key = randomBytes(32);

  it('round-trips a secret', () => {
    const secret = 'EAAG-demo-token-123';

    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it('round-trips Mongolian text and empty strings', () => {
    for (const secret of ['Сайн байна уу', '']) {
      expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
    }
  });

  it('never stores the plaintext and uses a fresh IV each time', () => {
    const secret = 'same-secret';
    const first = encryptSecret(secret, key);
    const second = encryptSecret(secret, key);

    expect(first).not.toContain(secret);
    expect(first).not.toBe(second);
    expect(first.startsWith('v1:')).toBe(true);
  });

  it('rejects the wrong key', () => {
    const payload = encryptSecret('secret', key);

    expect(() => decryptSecret(payload, randomBytes(32))).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptSecret('secret', key).split(
      ':',
    );
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    const tampered = [version, iv, tag, bytes.toString('base64')].join(':');

    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('rejects malformed payloads', () => {
    for (const payload of ['', 'plain-text', 'v2:a:b:c', 'v1:a:b:c:d']) {
      expect(() => decryptSecret(payload, key)).toThrow(
        'Unrecognized encrypted payload',
      );
    }
  });

  describe('parseEncryptionKey', () => {
    it('accepts a base64-encoded 32-byte key', () => {
      const raw = randomBytes(32).toString('base64');

      expect(parseEncryptionKey(raw)).toHaveLength(32);
    });

    it('rejects missing, placeholder and wrong-length keys', () => {
      for (const raw of [
        undefined,
        '',
        'replace-me',
        randomBytes(16).toString('base64'),
      ]) {
        expect(() => parseEncryptionKey(raw)).toThrow(/ENCRYPTION_KEY/);
      }
    });
  });
});
