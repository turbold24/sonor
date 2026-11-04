import type { ImageInput } from '../model/model.types.js';

// Customer photos, as Messenger attachments are stored with a message:
// { type: 'image', payload: { url } }. Stickers, including the thumbs-up "like", are image
// attachments too but carry a sticker_id; they aren't photos.

/** At most this many photos of one message go to the model. */
export const MAX_PHOTOS = 3;
/** Base64 grows a photo by a third; this keeps a model call under the relay's 4.5 MB limit. */
export const MAX_PHOTO_BYTES = 3_000_000;
/** Stands for a photo in the text the model sees. */
export const PHOTO_MARKER = '[зураг]';

const DOWNLOAD_TIMEOUT_MS = 10_000;
// Formats the Meta Model API reads (image-understanding docs).
const PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Thrown when a photo can't be read. The message never contains the URL. */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

/** URLs of the photos among a message's attachments, at most MAX_PHOTOS. */
export function photoUrls(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .flatMap((item: unknown) => {
      if (!isRecord(item) || item.type !== 'image' || !isRecord(item.payload)) {
        return [];
      }
      const { url, sticker_id: sticker } = item.payload;
      return typeof url === 'string' && url && sticker === undefined
        ? [url]
        : [];
    })
    .slice(0, MAX_PHOTOS);
}

/**
 * Downloads a photo and returns it as a base64 data URL, so the model doesn't have to
 * fetch the (short-lived) CDN link itself.
 */
export async function downloadPhoto(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ImageInput> {
  if (!url.startsWith('https://')) throw new PhotoError('not an https URL');
  const response = await fetchFn(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new PhotoError(`status ${response.status}`);

  const type = (response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!PHOTO_TYPES.has(type)) {
    throw new PhotoError(`unsupported type ${type || '-'}`);
  }
  if (Number(response.headers.get('content-length')) > MAX_PHOTO_BYTES) {
    throw new PhotoError('too large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new PhotoError('empty');
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError('too large');
  return { url: `data:${type};base64,${bytes.toString('base64')}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
