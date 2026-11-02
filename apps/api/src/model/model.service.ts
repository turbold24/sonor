import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModelError } from './model.errors.js';
import {
  MODEL_PROVIDER,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type ModelProvider,
  type ToolDefinition,
} from './model.types.js';
import { TokenBudgetService } from './token-budget.service.js';

export interface ModelCallOptions extends ChatOptions {
  tenantId: string;
}

// The entry point the agent uses: enforces the daily token budget, then logs usage.
// Logs carry counts and metadata only, never prompts, replies or the API key.
@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    @Inject(MODEL_PROVIDER) private readonly provider: ModelProvider,
    private readonly budget: TokenBudgetService,
  ) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ModelCallOptions,
  ): Promise<ChatResult> {
    const { tenantId, ...chatOptions } = options;
    await this.budget.assertWithinBudget(tenantId);

    const startedAt = Date.now();
    let result: ChatResult;
    try {
      result = await this.provider.chat(messages, tools, chatOptions);
    } catch (error) {
      this.logger.warn(
        `model call failed tenant=${tenantId} model=${this.provider.model} ms=${Date.now() - startedAt} ${describeError(error)}`,
      );
      throw error;
    }

    const dailyTotal = await this.budget.record(tenantId, result.usage);
    const { usage } = result;
    this.logger.log(
      `model call tenant=${tenantId} model=${result.model || this.provider.model} finish=${result.finishReason} ` +
        `tools=[${result.toolCalls.map((call) => call.name).join(',')}] ` +
        `in=${usage.inputTokens} cached=${usage.cachedInputTokens} out=${usage.outputTokens} reasoning=${usage.reasoningTokens} ` +
        `total=${usage.totalTokens} today=${dailyTotal}/${this.budget.dailyLimit} ms=${Date.now() - startedAt}`,
    );
    return result;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ModelError) {
    const { status, code } = error.details;
    return `kind=${error.kind} status=${status ?? '-'} code=${code ?? '-'} message="${error.message}"`;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
