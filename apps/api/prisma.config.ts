import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 doesn't load .env itself. The repo-root .env is shared with docker-compose.
config({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not env(): that throws when unset, and `prisma generate` must work without a database.
    url: process.env.DATABASE_URL ?? '',
  },
});
