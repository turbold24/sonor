# Sonor

Sonor is a Mongolian-language AI sales agent for small businesses on Facebook Messenger.

Customers ask about products, prices and availability in Mongolian, in Cyrillic or Latin script. Sonor answers from the business's own data using tool calling, drafts orders and sends payment links. The owner can take over any conversation at any time.

The agent runs on **Muse Spark via the Meta Model API**. Built for the Meta Global AI Developer Hackathon (Startup track).

> Status: early scaffold. The API currently exposes a health check; the agent, Messenger webhook and connectors are coming next.

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
docker-compose.yml  Local Postgres
```

## Run locally

Requirements: Node.js 22+, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up      # Postgres on localhost:5433
pnpm dev        # API on http://localhost:3000
```

Check it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":3,"timestamp":"..."}
```

### Scripts

| Command                        | What it does                     |
| ------------------------------ | -------------------------------- |
| `pnpm dev`                     | Run the API in watch mode        |
| `pnpm build` / `pnpm start`    | Build, then run the compiled API |
| `pnpm test`                    | Unit tests (Vitest)              |
| `pnpm lint`                    | ESLint                           |
| `pnpm format` / `format:check` | Prettier                         |
| `pnpm db:up` / `pnpm db:down`  | Start / stop local Postgres      |
