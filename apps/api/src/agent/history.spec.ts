import { toChatHistory, type StoredMessage } from './history.js';

describe('toChatHistory', () => {
  it('rebuilds customer, owner, agent and tool turns in order', () => {
    const rows: StoredMessage[] = [
      { role: 'CUSTOMER', text: 'Дээл байгаа юу?', toolCalls: null },
      {
        role: 'AGENT',
        text: null,
        toolCalls: [
          { id: 'c1', name: 'search_products', arguments: '{"query":"дээл"}' },
        ],
      },
      {
        role: 'TOOL',
        text: '{"results":[]}',
        toolCalls: { callId: 'c1', name: 'search_products' },
      },
      { role: 'AGENT', text: 'Олдсонгүй.', toolCalls: null },
      { role: 'SYSTEM', text: 'note for the owner', toolCalls: null },
      { role: 'OWNER', text: 'Маргааш ирнэ.', toolCalls: null },
    ];

    expect(toChatHistory(rows)).toEqual([
      { role: 'user', content: 'Дээл байгаа юу?' },
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'c1',
            name: 'search_products',
            rawArguments: '{"query":"дээл"}',
            arguments: { query: 'дээл' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"results":[]}' },
      { role: 'assistant', content: 'Олдсонгүй.', toolCalls: [] },
      { role: 'assistant', content: 'Маргааш ирнэ.' },
    ]);
  });

  it('drops calls without results and results without calls', () => {
    const rows: StoredMessage[] = [
      // The window started after this result's call.
      { role: 'TOOL', text: '{}', toolCalls: { callId: 'old', name: 'x' } },
      { role: 'CUSTOMER', text: 'hi', toolCalls: null },
      // The turn crashed before its result was stored.
      {
        role: 'AGENT',
        text: null,
        toolCalls: [{ id: 'c9', name: 'get_product', arguments: '{}' }],
      },
    ];

    expect(toChatHistory(rows)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('marks customer photos and skips stickers', () => {
    const photo = { type: 'image', payload: { url: 'https://a.test/1.jpg' } };
    const like = {
      type: 'image',
      payload: { url: 'https://a.test/like.png', sticker_id: 369239263222822 },
    };
    const rows: StoredMessage[] = [
      { role: 'CUSTOMER', text: null, toolCalls: null, attachments: [photo] },
      {
        role: 'CUSTOMER',
        text: 'Энэ байгаа юу?',
        toolCalls: null,
        attachments: [photo],
      },
      { role: 'CUSTOMER', text: null, toolCalls: null, attachments: [like] },
    ];

    expect(toChatHistory(rows)).toEqual([
      { role: 'user', content: '[зураг]' },
      { role: 'user', content: 'Энэ байгаа юу?\n[зураг]' },
    ]);
  });
});
