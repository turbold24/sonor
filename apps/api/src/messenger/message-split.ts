/** Messenger's limit for one text message. */
export const MESSENGER_TEXT_LIMIT = 2000;

/**
 * Splits text into parts of at most `limit` characters, preferring paragraph, line,
 * sentence and word boundaries, in that order.
 */
export function splitMessage(
  text: string,
  limit = MESSENGER_TEXT_LIMIT,
): string[] {
  const parts: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    const cut =
      lastBreak(window, /\n\n/g) ??
      lastBreak(window, /\n/g) ??
      lastBreak(window, /[.!?…](?=\s)/g, 1) ??
      lastBreak(window, /\s/g) ??
      limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Position after the last match within the window, if it leaves a useful first part. */
function lastBreak(
  window: string,
  pattern: RegExp,
  keep = 0,
): number | undefined {
  let position: number | undefined;
  for (const match of window.matchAll(pattern)) {
    const end = match.index + keep;
    if (end > 0 && end <= window.length - 1) position = end;
  }
  // Ignore breaks so early that the first part would be tiny.
  return position !== undefined && position >= window.length / 2
    ? position
    : undefined;
}
