import type {
  ChatMessage,
  ChatResult,
  ToolCall,
  ToolDefinition,
} from '../model/model.types.js';
import { runAgentTurn, type TurnDeps } from './agent-turn.js';

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  cachedInputTokens: 0,
  reasoningTokens: 10,
};

const answer = (text: string): ChatResult => ({
  text,
  toolCalls: [],
  finishReason: 'stop',
  usage,
  model: 'muse-spark-1.3',
});

const toolCall = (name: string, args: Record<string, unknown>): ChatResult => {
  const call: ToolCall = {
    id: `call_${name}`,
    name,
    rawArguments: JSON.stringify(args),
    arguments: args,
  };
  return {
    ...answer(''),
    text: null,
    toolCalls: [call],
    finishReason: 'tool_calls',
  };
};

const input = {
  messages: [
    { role: 'system', content: 'prompt' },
    { role: 'user', content: 'Эрэгтэй дээл хэд вэ?' },
  ] satisfies ChatMessage[],
  tools: [] as ToolDefinition[],
  maxIterations: 4,
  allowedNumbers: new Set<number>(),
  fallbackReply: 'FALLBACK',
  correction: (prices: number[]) => `CORRECTION ${prices.join(',')}`,
  answerNow: 'ANSWER NOW',
};

const PRODUCT = '{"results":[{"name":"Эрэгтэй богино дээл","price":245000}]}';

function deps(...results: ChatResult[]) {
  const seen: ChatMessage[][] = [];
  const chat = vi.fn<TurnDeps['chat']>((messages) => {
    seen.push([...messages]);
    const next = results.shift();
    if (!next) throw new Error('unexpected model call');
    return Promise.resolve(next);
  });
  const runTool = vi.fn<TurnDeps['runTool']>(() => Promise.resolve(PRODUCT));
  return { chat, runTool, seen };
}

describe('runAgentTurn', () => {
  it('runs tools, then returns the grounded answer', async () => {
    const d = deps(
      toolCall('search_products', { query: 'дээл' }),
      answer('Эрэгтэй богино дээл **245,000₮**, байгаа.'),
    );

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('Эрэгтэй богино дээл 245,000₮, байгаа.');
    expect(outcome.fallback).toBe('none');
    expect(outcome.regenerated).toBe(false);
    expect(outcome.steps).toEqual([
      {
        calls: [expect.objectContaining({ name: 'search_products' })],
        outputs: [PRODUCT],
      },
    ]);
    expect(outcome.usage).toMatchObject({ calls: 2, totalTokens: 240 });
    // The second call sees the tool call and its result.
    expect(d.seen[1].slice(-2)).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      { role: 'tool', toolCallId: 'call_search_products', content: PRODUCT },
    ]);
  });

  it('regenerates once when a price is not in the tool results', async () => {
    const d = deps(
      toolCall('search_products', { query: 'дээл' }),
      answer('Хямдралтай 199,000₮.'),
      answer('Эрэгтэй богино дээл 245,000₮.'),
    );

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('Эрэгтэй богино дээл 245,000₮.');
    expect(outcome.regenerated).toBe(true);
    expect(outcome.fallback).toBe('none');
    expect(d.seen[2].at(-1)).toEqual({
      role: 'system',
      content: 'CORRECTION 199000',
    });
  });

  it('lets the regeneration look the price up first', async () => {
    const d = deps(
      answer('Ойролцоогоор 300,000₮.'),
      toolCall('get_product', { productId: 'p1' }),
      answer('245,000₮ байна.'),
    );

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('245,000₮ байна.');
    expect(d.runTool).toHaveBeenCalledTimes(1);
  });

  it('falls back when the regenerated reply is still ungrounded', async () => {
    const d = deps(answer('300,000₮.'), answer('Магадгүй 310,000₮.'));

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('FALLBACK');
    expect(outcome.fallback).toBe('ungrounded');
  });

  it('allows numbers from the shop settings, e.g. a phone number', async () => {
    const d = deps(answer('Манай утас 7700 1234.'));

    const outcome = await runAgentTurn(
      { ...input, allowedNumbers: new Set([7700, 1234]) },
      d,
    );

    expect(outcome.reply).toBe('Манай утас 7700 1234.');
  });

  it('asks for an answer once the tool rounds run out', async () => {
    const d = deps(
      ...Array.from({ length: 4 }, () =>
        toolCall('search_products', { query: 'x' }),
      ),
      answer('Олдсонгүй, өөр юу хайх вэ?'),
    );

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('Олдсонгүй, өөр юу хайх вэ?');
    expect(outcome.fallback).toBe('none');
    expect(outcome.steps).toHaveLength(4);
    expect(outcome.usage.calls).toBe(5);
    expect(d.seen[4].at(-1)).toEqual({ role: 'system', content: 'ANSWER NOW' });
  });

  it('falls back without running tools asked for after the last round', async () => {
    const d = deps(
      ...Array.from({ length: 5 }, () =>
        toolCall('search_products', { query: 'x' }),
      ),
    );

    const outcome = await runAgentTurn(input, d);

    expect(outcome.reply).toBe('FALLBACK');
    expect(outcome.fallback).toBe('max_iterations');
    expect(d.chat).toHaveBeenCalledTimes(5);
    expect(d.runTool).toHaveBeenCalledTimes(4);
    expect(outcome.steps).toHaveLength(4);
  });

  it('falls back on an empty answer', async () => {
    const outcome = await runAgentTurn(input, deps(answer('  ')));

    expect(outcome.fallback).toBe('no_answer');
    expect(outcome.reply).toBe('FALLBACK');
  });
});
