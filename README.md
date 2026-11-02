# Sonor

Sonor is a Mongolian-language AI sales agent for small businesses on Facebook Messenger.

Customers ask about products, prices and availability in Mongolian, in Cyrillic or Latin script. Sonor answers from the business's own data using tool calling, drafts orders and sends payment links. The owner can take over any conversation at any time.

The agent runs on **Muse Spark via the Meta Model API**. Built for the Meta Global AI Developer Hackathon (Startup track).

> Status: early build. The database schema, demo data and model layer are in place, and the API exposes a health check. The agent, Messenger webhook and connectors are coming next.

## How it works

- **Channel:** Facebook Messenger (Page webhook)
- **Model:** Muse Spark through the Meta Model API, with tool calling
- **Data connectors:**
  - `DemoConnector`: synthetic data for fictional businesses (default, so the repo runs standalone)
  - `PlatformConnector`: calls an existing private platform's API

## Stack

TypeScript, NestJS, Prisma + PostgreSQL, pnpm workspace.

```
apps/api            NestJS backend
apps/api/prisma     Schema, migrations, demo seed
docker-compose.yml  Local Postgres
```

## Data model

Each business is a `Tenant`, and every other table carries a `tenantId`. Tables: `Tenant`, `Product` (DEMO tenants only), `Customer`, `Conversation`, `Message`, `Order`, `OrderItem`, `PaymentLink`.

Page access tokens and platform API keys are encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY`. Order items store a server-side snapshot of the unit price. Prices are whole tögrög (MNT).

## Demo data

`pnpm db:seed` creates two fictional shops with placeholder Page IDs and no real tokens:

- **Салхин Дээл**: modern deel and winter wear, 12 products with sizes and colors
- **Шүүдэр Гоо**: cosmetics, 11 products

Some items are out of stock, a few are low, and one is inactive, so you can test how the agent handles them. Re-running the seed replaces each shop's catalog. It never overwrites a Page ID or token you have set on a tenant.

## Model

Sonor calls **Muse Spark 1.3** (`muse-spark-1.3`) through the Meta Model API's Responses endpoint (`POST https://api.meta.ai/v1/responses`). Requests are stateless (`store: false`), so Meta keeps no copy of the conversation. The model's encrypted reasoning is passed back on the next turn so it keeps its train of thought through tool calls.

The agent talks to a provider-neutral `ModelProvider` interface (`apps/api/src/model`). `MODEL_PROVIDER` and `MODEL_ID` select the implementation, so another provider (for example Muse Spark Open behind an OpenAI-compatible endpoint) can be added without changing agent code.

Cost and safety controls, all set in `.env`:

- `MODEL_TIMEOUT_MS` per request, with up to `MODEL_MAX_RETRIES` retries (exponential backoff) for 429 and 5xx responses only
- `MODEL_MAX_OUTPUT_TOKENS` per call (includes reasoning tokens)
- `DAILY_TOKEN_LIMIT` per tenant per UTC day. Usage is stored in the `TokenUsage` table, and new calls are refused once the limit is reached.
- Logs record token counts and timings only, never prompts, replies or the API key

To check your key and the model end to end:

```bash
pnpm model:smoke
```

It sends a short Mongolian message, then a message with a dummy `get_weather` tool, checks that the tool call parses, and returns a fake result for a final answer.

## Run locally

Requirements: Node.js 22.18+ (or 24.11+), pnpm 11, Docker.

1. Install dependencies. This also generates the Prisma client.

   ```bash
   pnpm install
   ```

2. Create your `.env`, then set `ENCRYPTION_KEY` to the output of `openssl rand -base64 32`. To use the model, also set `MODEL_API_KEY` to a key from the Model API dashboard.

   ```bash
   cp .env.example .env
   ```

3. Start Postgres (localhost:5433), apply migrations and load demo data.

   ```bash
   pnpm db:up
   pnpm db:migrate
   pnpm db:seed
   ```

4. Run the API on http://localhost:3000.

   ```bash
   pnpm dev
   ```

Check it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":3,"timestamp":"..."}
```

### Scripts

| Command                        | What it does                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `pnpm dev`                     | Run the API in watch mode                                              |
| `pnpm build` / `pnpm start`    | Build, then run the compiled API                                       |
| `pnpm test`                    | Unit tests (Vitest)                                                    |
| `pnpm lint`                    | ESLint                                                                 |
| `pnpm format` / `format:check` | Prettier                                                               |
| `pnpm db:up` / `pnpm db:down`  | Start / stop local Postgres                                            |
| `pnpm db:migrate`              | Apply migrations; with a schema change, create one (`--name <change>`) |
| `pnpm db:seed`                 | Load the demo shops                                                    |
| `pnpm db:reset`                | Drop the local database, re-apply migrations, re-seed                  |
| `pnpm db:generate`             | Regenerate the Prisma client                                           |
| `pnpm model:smoke`             | Live check of the model API (needs `MODEL_API_KEY`)                    |
| `pnpm db:studio`               | Browse data in Prisma Studio                                           |
