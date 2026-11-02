import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for secrets stored in the database (Page access tokens, platform API keys).
// Payload format: v1:<iv>:<authTag>:<ciphertext>, each part base64.

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/** Parses ENCRYPTION_KEY: 32 random bytes, base64-encoded. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const key = Buffer.from(raw?.trim() ?? '', 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-encoded. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Throws if the payload is malformed, was tampered with, or the key is wrong. */
export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, authTag, ciphertext, ...rest] = payload.split(':');
  if (
    version !== VERSION ||
    !iv ||
    !authTag ||
    ciphertext === undefined ||
    rest.length > 0
  ) {
    throw new Error('Unrecognized encrypted payload');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'), {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
