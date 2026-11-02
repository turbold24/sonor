import { ModelError } from '../model.errors.js';
import type { ChatMessage, ToolDefinition } from '../model.types.js';
import {
  fromResponsesResponse,
  toResponsesRequest,
} from './meta-responses.mapper.js';

const options = {
  model: 'muse-spark-1.3',
  maxOutputTokens: 1024,
  reasoningEffort: 'low' as const,
};

const getWeather: ToolDefinition = {
  name: 'get_weather',
  description: 'Current weather for a city.',
  parameters: {
    type: 'object',
    properties: { location: { type: 'string' } },
    required: ['location'],
  },
};

describe('toResponsesRequest', () => {
  it('builds a stateless request with reasoning replay enabled', () => {
    const body = toResponsesRequest(
      [{ role: 'user', content: 'Сайн уу' }],
      [],
      options,
    );

    expect(body).toEqual({
      model: 'muse-spark-1.3',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Сайн уу' }],
        },
      ],
      max_output_tokens: 1024,
      reasoning: { effort: 'low' },
      store: false,
      include: ['reasoning.encrypted_content'],
    });
  });

  it('maps tools to flat function tools and passes optional settings', () => {
    const body = toResponsesRequest(
      [{ role: 'user', content: 'hi' }],
      [getWeather],
      { ...options, parallelToolCalls: false, safetyIdentifier: 'abc123' },
    );

    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Current weather for a city.',
        parameters: getWeather.parameters,
        strict: false,
      },
    ]);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.safety_identifier).toBe('abc123');
  });

  it('maps every message role in order', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: 'Энэ байгаа юу?',
        images: [{ url: 'https://example.com/deel.jpg' }],
      },
      {
        role: 'assistant',
        content: 'Шалгая.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'search_products',
            rawArguments: '{"query":"дээл"}',
            arguments: { query: 'дээл' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: '{"found":2}' },
      { role: 'assistant', content: '2 төрөл байна.' },
    ];

    expect(toResponsesRequest(messages, [], options).input).toEqual([
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'Be brief.' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Энэ байгаа юу?' },
          { type: 'input_image', image_url: 'https://example.com/deel.jpg' },
        ],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Шалгая.' }],
        phase: 'commentary',
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'search_products',
        arguments: '{"query":"дээл"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"found":2}',
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '2 төрөл байна.' }],
      },
    ]);
  });

  it('replays saved Meta output items instead of rebuilding the turn', () => {
    const saved = [
      { type: 'reasoning', summary: [], encrypted_content: 'enc' },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{}',
      },
    ];

    const input = toResponsesRequest(
      [
        {
          role: 'assistant',
          content: null,
          toolCalls: [],
          providerState: { provider: 'meta', data: saved },
        },
      ],
      [],
      options,
    ).input;

    expect(input).toEqual(saved);
  });

  it('ignores provider state from other providers', () => {
    const input = toResponsesRequest(
      [
        {
          role: 'assistant',
          content: 'hello',
          providerState: { provider: 'other', data: [{ type: 'x' }] },
        },
      ],
      [],
      options,
    ).input;

    expect(input).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello' }],
      },
    ]);
  });
});

describe('fromResponsesResponse', () => {
  const usage = {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 60,
    output_tokens_details: { reasoning_tokens: 45 },
    total_tokens: 160,
  };

  it('maps a text answer and usage', () => {
    const result = fromResponsesResponse({
      status: 'completed',
      model: 'muse-spark-1.3',
      output: [
        {
          id: 'rs_1',
          type: 'reasoning',
          summary: [],
          encrypted_content: 'enc',
          status: 'completed',
        },
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: 'Сайн байна уу!', annotations: [] },
          ],
        },
      ],
      usage,
    });

    expect(result.text).toBe('Сайн байна уу!');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 60,
      totalTokens: 160,
      cachedInputTokens: 40,
      reasoningTokens: 45,
    });
    expect(result.providerState).toEqual({
      provider: 'meta',
      data: [
        {
          type: 'reasoning',
          id: 'rs_1',
          summary: [],
          encrypted_content: 'enc',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Сайн байна уу!' }],
        },
      ],
    });
  });

  it('maps tool calls, keeps commentary out of the answer text', () => {
    const result = fromResponsesResponse({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'Let me check.' }],
        },
        {
          type: 'function_call',
          call_id: 'call_abc',
          name: 'get_weather',
          arguments: '{"location":"Улаанбаатар"}',
          status: 'completed',
        },
      ],
      usage,
    });

    expect(result.text).toBeNull();
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([
      {
        id: 'call_abc',
        name: 'get_weather',
        rawArguments: '{"location":"Улаанбаатар"}',
        arguments: { location: 'Улаанбаатар' },
      },
    ]);
    expect(result.providerState?.data).toEqual([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Let me check.' }],
        phase: 'commentary',
      },
      {
        type: 'function_call',
        call_id: 'call_abc',
        name: 'get_weather',
        arguments: '{"location":"Улаанбаатар"}',
      },
    ]);
  });

  it('returns null arguments for malformed JSON and {} for empty arguments', () => {
    const result = fromResponsesResponse({
      status: 'completed',
      output: [
        { type: 'function_call', call_id: 'a', name: 'f', arguments: '{oops' },
        { type: 'function_call', call_id: 'b', name: 'g', arguments: '' },
        { type: 'function_call', call_id: 'c', name: 'h', arguments: '[1]' },
      ],
    });

    expect(result.toolCalls.map((call) => call.arguments)).toEqual([
      null,
      {},
      null,
    ]);
  });

  it('marks output-limit cut-offs as length and drops unusable items', () => {
    const result = fromResponsesResponse({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [
        { type: 'reasoning', summary: [], encrypted_content: 'enc' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: '{"loc',
          status: 'incomplete',
        },
      ],
    });

    expect(result.finishReason).toBe('length');
    expect(result.toolCalls).toEqual([]);
    expect(result.text).toBeNull();
    // A trailing reasoning item can't be replayed on its own.
    expect(result.providerState).toBeUndefined();
  });

  it('throws on failed responses and unexpected shapes', () => {
    expect(() =>
      fromResponsesResponse({
        status: 'failed',
        output: [],
        error: { code: 'server_error', message: 'boom' },
      }),
    ).toThrow(ModelError);
    expect(() => fromResponsesResponse({ status: 'completed' })).toThrow(
      'Unexpected response shape',
    );
    expect(() => fromResponsesResponse('nope')).toThrow(ModelError);
  });
});
