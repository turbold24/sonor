import {
  downloadPhoto,
  MAX_PHOTO_BYTES,
  PhotoError,
  photoUrls,
} from './photos.js';

const URL = 'https://cdn.example.test/photo.jpg';

describe('photoUrls', () => {
  it('keeps image attachments and skips stickers and other types', () => {
    expect(
      photoUrls([
        { type: 'image', payload: { url: 'https://a.test/1.jpg' } },
        {
          type: 'image',
          payload: {
            url: 'https://a.test/like.png',
            sticker_id: 369239263222822,
          },
        },
        { type: 'audio', payload: { url: 'https://a.test/voice.mp4' } },
        { type: 'image', payload: {} },
        { type: 'image' },
        'junk',
      ]),
    ).toEqual(['https://a.test/1.jpg']);
  });

  it('takes at most three photos', () => {
    const photos = [1, 2, 3, 4].map((n) => ({
      type: 'image',
      payload: { url: `https://a.test/${n}.jpg` },
    }));
    expect(photoUrls(photos)).toHaveLength(3);
  });

  it('returns nothing for missing attachments', () => {
    expect(photoUrls(null)).toEqual([]);
    expect(photoUrls(undefined)).toEqual([]);
  });
});

describe('downloadPhoto', () => {
  const respond = (
    body: BodyInit | null,
    headers: Record<string, string>,
    status = 200,
  ) =>
    vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(body, { status, headers })),
    );

  it('returns the photo as a base64 data URL', async () => {
    const fetchFn = respond(new Uint8Array([1, 2, 3]), {
      'content-type': 'image/jpeg',
    });

    await expect(downloadPhoto(URL, fetchFn)).resolves.toEqual({
      url: 'data:image/jpeg;base64,AQID',
    });
    expect(fetchFn).toHaveBeenCalledWith(URL, expect.anything());
  });

  it('refuses non-https URLs without fetching', async () => {
    const fetchFn = respond('x', { 'content-type': 'image/png' });

    await expect(
      downloadPhoto('http://cdn.example.test/a.png', fetchFn),
    ).rejects.toThrow(PhotoError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['an error status', respond('no', { 'content-type': 'image/jpeg' }, 403)],
    ['a non-image type', respond('<html>', { 'content-type': 'text/html' })],
    ['an empty body', respond(null, { 'content-type': 'image/png' })],
    [
      'a declared size over the limit',
      respond('x', {
        'content-type': 'image/png',
        'content-length': String(MAX_PHOTO_BYTES + 1),
      }),
    ],
    [
      'a body over the limit',
      respond(new Uint8Array(MAX_PHOTO_BYTES + 1), {
        'content-type': 'image/webp',
      }),
    ],
  ])('refuses %s', async (_case, fetchFn) => {
    await expect(downloadPhoto(URL, fetchFn)).rejects.toThrow(PhotoError);
  });

  it('never puts the URL in the error', async () => {
    const error = await downloadPhoto(
      URL,
      respond('no', { 'content-type': 'image/jpeg' }, 404),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PhotoError);
    expect((error as Error).message).not.toContain('example.test');
  });
});
