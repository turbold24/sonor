import { parseWebhook } from './messenger.events.js';

const PAGE = '1001';
const USER = '2002';

const page = (...messaging: unknown[]) => ({
  object: 'page',
  entry: [{ id: PAGE, time: 1, messaging }],
});

describe('parseWebhook', () => {
  it('parses a customer text message', () => {
    expect(
      parseWebhook(
        page({
          sender: { id: USER },
          recipient: { id: PAGE },
          timestamp: 1,
          message: { mid: 'm1', text: 'deel bga yu?' },
        }),
      ),
    ).toEqual([
      {
        kind: 'message',
        pageId: PAGE,
        psid: USER,
        mid: 'm1',
        text: 'deel bga yu?',
        attachments: [],
      },
    ]);
  });

  it('keeps attachments and allows an empty text', () => {
    const [event] = parseWebhook(
      page({
        sender: { id: USER },
        recipient: { id: PAGE },
        message: {
          mid: 'm2',
          attachments: [
            { type: 'image', payload: { url: 'https://x.test/a.jpg' } },
            { type: 'sticker', payload: { sticker_id: 369239263222822 } },
          ],
        },
      }),
    );
    expect(event).toMatchObject({
      kind: 'message',
      text: '',
      attachments: [
        { type: 'image', payload: { url: 'https://x.test/a.jpg' } },
        { type: 'sticker', payload: { sticker_id: 369239263222822 } },
      ],
    });
  });

  it('parses an echo with the customer as the recipient', () => {
    const [event] = parseWebhook(
      page({
        sender: { id: PAGE },
        recipient: { id: USER },
        message: {
          mid: 'm3',
          text: 'Сайн байна уу, би менежер.',
          is_echo: true,
          app_id: 263902037430900,
        },
      }),
    );
    expect(event).toEqual({
      kind: 'echo',
      pageId: PAGE,
      psid: USER,
      mid: 'm3',
      text: 'Сайн байна уу, би менежер.',
      attachments: [],
      appId: '263902037430900',
      metadata: undefined,
    });
  });

  it('treats a postback as a customer message', () => {
    expect(
      parseWebhook(
        page({
          sender: { id: USER },
          recipient: { id: PAGE },
          postback: { mid: 'm4', title: 'Get Started', payload: 'GET_STARTED' },
        }),
      ),
    ).toEqual([
      {
        kind: 'message',
        pageId: PAGE,
        psid: USER,
        mid: 'm4',
        text: 'Get Started',
        attachments: [],
      },
    ]);
  });

  it('skips deliveries, reads, other objects and malformed events', () => {
    expect(
      parseWebhook(
        page(
          { sender: { id: USER }, delivery: { mids: ['m1'] } },
          { sender: { id: USER }, read: { watermark: 1 } },
          { sender: { id: USER }, message: { text: 'no mid' } },
          'not an object',
        ),
      ),
    ).toEqual([]);
    expect(parseWebhook({ object: 'instagram', entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });

  it('handles several entries and events in one delivery', () => {
    const events = parseWebhook({
      object: 'page',
      entry: [
        {
          id: PAGE,
          messaging: [
            { sender: { id: USER }, message: { mid: 'a', text: '1' } },
            { sender: { id: USER }, message: { mid: 'b', text: '2' } },
          ],
        },
        {
          id: '9009',
          messaging: [
            { sender: { id: USER }, message: { mid: 'c', text: '3' } },
          ],
        },
      ],
    });
    expect(events.map((event) => [event.pageId, event.mid])).toEqual([
      [PAGE, 'a'],
      [PAGE, 'b'],
      ['9009', 'c'],
    ]);
  });
});
