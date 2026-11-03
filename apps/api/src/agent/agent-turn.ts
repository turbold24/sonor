import {
  toAssistantMessage,
  type ChatMessage,
  type ChatResult,
  type TokenUsage,
  type ToolCall,
  type ToolDefinition,
} from '../model/model.types.js';
import { numbersIn, ungroundedPrices } from './grounding.js';
import { stripMarkdown } from './reply-text.js';

// Model calls allowed for the one regeneration after a failed grounding check, so the
// model can look the price up again before answering.
const REGENERATE_ITERATIONS = 2;

export interface TurnInput {
  /** System prompt plus history, ending with the customer's message. */
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxIterations: number;
  /** Numbers the reply may contain besides tool results, e.g. the shop's contact info. */
  allowedNumbers: Set<number>;
  fallbackReply: string;
  correction: (prices: number[]) => string;
  /** Sent when the tool rounds run out, asking for an answer from the results so far. */
  answerNow: string;
}

export interface TurnDeps {
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResult>;
  /** Runs a tool and returns the serialized output given to the model. */
  runTool(call: ToolCall): Promise<string>;
}

export interface ToolStep {
  calls: ToolCall[];
  outputs: string[];
}

export type TurnFallback =
  'none' | 'ungrounded' | 'max_iterations' | 'no_answer';

export interface TurnOutcome {
  reply: string;
  steps: ToolStep[];
  usage: TokenUsage & { calls: number };
  regenerated: boolean;
  fallback: TurnFallback;
}

export async function runAgentTurn(
  input: TurnInput,
  deps: TurnDeps,
): Promise<TurnOutcome> {
  const messages = [...input.messages];
  const steps: ToolStep[] = [];
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    calls: 0,
  };

  // Runs the tool loop; returns the final text, null for an empty answer, or
  // undefined if the model was still calling tools when the budget ran out.
  const loop = async (budget: number): Promise<string | null | undefined> => {
    for (let i = 0; i < budget; i++) {
      const result = await deps.chat(messages, input.tools);
      addUsage(usage, result.usage);
      messages.push(toAssistantMessage(result));
      if (result.toolCalls.length === 0) return result.text;

      const step: ToolStep = { calls: result.toolCalls, outputs: [] };
      for (const call of result.toolCalls) {
        const output = await deps.runTool(call);
        step.outputs.push(output);
        messages.push({ role: 'tool', toolCallId: call.id, content: output });
      }
      steps.push(step);
    }
    return undefined;
  };

  const finish = (
    reply: string,
    fallback: TurnFallback,
    regenerated: boolean,
  ): TurnOutcome => ({ reply, steps, usage, regenerated, fallback });

  const allowed = () =>
    new Set([
      ...input.allowedNumbers,
      ...numbersIn(steps.flatMap((step) => step.outputs)),
    ]);

  let text = await loop(input.maxIterations);
  if (text === undefined) {
    // Tool rounds used up: one more call to answer from what the tools returned. Tools
    // it still asks for are not run.
    messages.push({ role: 'system', content: input.answerNow });
    const result = await deps.chat(messages, input.tools);
    addUsage(usage, result.usage);
    messages.push(toAssistantMessage(result));
    if (result.toolCalls.length > 0) {
      return finish(input.fallbackReply, 'max_iterations', false);
    }
    text = result.text;
  }
  if (!text?.trim()) return finish(input.fallbackReply, 'no_answer', false);

  const reply = stripMarkdown(text);
  const unsupported = ungroundedPrices(reply, allowed());
  if (unsupported.length === 0) return finish(reply, 'none', false);

  messages.push({ role: 'system', content: input.correction(unsupported) });
  const retry = await loop(REGENERATE_ITERATIONS);
  if (retry?.trim()) {
    const retryReply = stripMarkdown(retry);
    if (ungroundedPrices(retryReply, allowed()).length === 0) {
      return finish(retryReply, 'none', true);
    }
  }
  return finish(input.fallbackReply, 'ungrounded', true);
}

function addUsage(
  total: TokenUsage & { calls: number },
  usage: TokenUsage,
): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  total.totalTokens += usage.totalTokens;
  total.cachedInputTokens += usage.cachedInputTokens;
  total.reasoningTokens += usage.reasoningTokens;
  total.calls++;
}
