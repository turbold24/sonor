# Sonor API image. Installs the workspace, builds the NestJS app, and on start applies
# pending database migrations before serving. Runs as one instance: the per-customer
# message queue is in memory.
FROM node:24-slim

# Prisma's migration engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependencies first, so code changes don't reinstall them. The API's postinstall runs
# `prisma generate`, which needs the schema and Prisma config.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @sonor/api build

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
