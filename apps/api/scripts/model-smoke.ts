import { config } from 'dotenv';
import { loadModelConfig } from '../src/model/model.config.js';
import { ModelError } from '../src/model/model.errors.js';
import { createModelProvider } from '../src/model/model-provider.factory.js';
import {
  toAssistantMessage,
  type ChatMessage,
  type ChatResult,
  type ToolDefinition,
} from '../src/model/model.types.js';

// Live check against the configured model provider (costs a few thousand tokens).
// Calls the provider directly, so no database or tenant budget is involved.

config({ path: ['.env', '../../.env'], quiet: true });

const modelConfig = loadModelConfig((name) => process.env[name]);
const provider = createModelProvider(modelConfig);

const getWeather: ToolDefinition = {
  name: 'get_weather',
  description: 'Return the current weather for a city.',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
    additionalProperties: false,
  },
};

let totalTokens = 0;

async function call(
  label: string,
  messages: ChatMessage[],
  tools: ToolDefinition[] = [],
): Promise<ChatResult> {
  const startedAt = Date.now();
  const result = await provider.chat(messages, tools);
  const { usage } = result;
  totalTokens += usage.totalTokens;
  console.log(
    `\n[${label}] finish=${result.finishReason} ${Date.now() - startedAt} ms, tokens in=${usage.inputTokens} out=${usage.outputTokens} (reasoning ${usage.reasoningTokens})`,
  );
  return result;
}

function fail(message: string): never {
  throw new Error(message);
}

console.log(
  `Provider: ${provider.name}  Model: ${provider.model}  Endpoint: ${modelConfig.baseUrl}/responses  Effort: ${modelConfig.reasoningEffort}`,
);

try {
  // 1. A short Mongolian exchange.
  const greeting = await call('mongolian', [
    {
      role: 'system',
      content: 'Чи монгол хэлээр товч, эелдэг хариулдаг туслах.',
    },
    {
      role: 'user',
      content: 'Сайн байна уу? Өөрийгөө нэг өгүүлбэрээр танилцуулна уу.',
    },
  ]);
  if (!greeting.text) fail('No text in the Mongolian reply');
  console.log(`Reply: ${greeting.text}`);

  // 2. One dummy tool: the model should call it with parseable arguments.
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Цаг агаарын асуултад заавал get_weather хэрэгслийг ашиглаж хариул.',
    },
    { role: 'user', content: 'Улаанбаатарт одоо цаг агаар ямар байна?' },
  ];
  const first = await call('tool call', messages, [getWeather]);
  const weatherCall =
    first.toolCalls.find((toolCall) => toolCall.name === 'get_weather') ??
    fail(`Expected a get_weather call, got finish=${first.finishReason}`);
  const location = weatherCall.arguments?.location;
  if (typeof location !== 'string' || !location) {
    fail(`Unparseable arguments: ${weatherCall.rawArguments}`);
  }
  console.log(
    `Tool call: ${weatherCall.name}(${weatherCall.rawArguments}) id=${weatherCall.id}`,
  );
  console.log(`Parsed: location = "${location}"`);

  // 3. Return a fake result to finish the loop (exercises reasoning replay).
  messages.push(toAssistantMessage(first));
  for (const toolCall of first.toolCalls) {
    messages.push({
      role: 'tool',
      toolCallId: toolCall.id,
      content: JSON.stringify({
        location,
        temperatureC: -18,
        condition: 'цэлмэг',
      }),
    });
  }
  const final = await call('tool result', messages, [getWeather]);
  if (!final.text) fail('No text after the tool result');
  console.log(`Reply: ${final.text}`);

  console.log(`\nSmoke test passed. Total tokens: ${totalTokens}`);
} catch (error) {
  const reason =
    error instanceof ModelError
      ? `${error.kind}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`\nSmoke test failed: ${reason}`);
  process.exit(1);
}
