import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks Meta's X-Hub-Signature-256 header: "sha256=" + hex HMAC-SHA256 of the request
 * body, keyed with the App Secret. It must be computed over the raw bytes as received:
 * Meta escapes non-ASCII characters, so re-serialized JSON would not match.
 */
export function verifySignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return timingSafeEqual(received, expected);
}

export function signBody(body: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
}

/** Constant-time string comparison, e.g. for the webhook verify token. */
export function safeEqual(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
