import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { decryptSecret, parseEncryptionKey } from '../src/common/encryption.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { GraphClient, GraphError } from '../src/messenger/graph.client.js';
import { loadMessengerConfig } from '../src/messenger/messenger.config.js';

// Sets the conversation starters (Messenger ice breakers) of a tenant's Page: up to four
// questions a customer can tap when opening a new chat. A tap reaches Sonor as that
// question. Uses the tenant's stored Page token, which is never printed.

const USAGE = `Usage: pnpm tenant:starters --tenant <slug> [--question "<text>" ...] [--clear]

Without --question or --clear, prints the Page's current conversation starters.

  --question  A question shown in a new chat. Repeat for up to 4 questions.
  --clear     Remove all conversation starters.`;

const MAX_QUESTIONS = 4;

config({ path: ['.env', '../../.env'], quiet: true });

class UsageError extends Error {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      question: { type: 'string', multiple: true, default: [] },
      clear: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const slug = values.tenant?.trim();
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!slug) throw new UsageError(USAGE);
  const questions = values.question.map((question) => question.trim());
  if (questions.some((question) => !question)) {
    throw new UsageError('A --question is empty.');
  }
  if (questions.length > MAX_QUESTIONS) {
    throw new UsageError(
      `Messenger allows at most ${MAX_QUESTIONS} questions.`,
    );
  }
  if (values.clear && questions.length > 0) {
    throw new UsageError('Use either --question or --clear, not both.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let token: string;
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new UsageError(`No tenant with slug "${slug}".`);
    if (!/^\d+$/.test(tenant.facebookPageId)) {
      throw new UsageError(
        `Tenant "${slug}" has no Facebook Page yet. Run pnpm tenant:connect-page first.`,
      );
    }
    token = decryptSecret(
      tenant.pageAccessTokenEncrypted,
      parseEncryptionKey(process.env.ENCRYPTION_KEY),
    );
  } finally {
    await prisma.$disconnect();
  }

  const messenger = loadMessengerConfig((name) => process.env[name]);
  const graph = new GraphClient({
    version: messenger.graphVersion,
    appSecret: messenger.appSecret,
  });

  if (values.clear) {
    await graph.deleteIceBreakers(token);
    console.log(`Removed the conversation starters of "${slug}".`);
    return;
  }
  if (questions.length > 0) {
    await graph.setIceBreakers(token, questions);
    console.log(`Set ${questions.length} conversation starters for "${slug}".`);
  }
  const current = await graph.iceBreakers(token);
  console.log(
    current.length > 0
      ? `Conversation starters of "${slug}":\n${current.map((q) => `- ${q}`).join('\n')}`
      : `"${slug}" has no conversation starters.`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof GraphError
      ? `Graph API error: ${error.describe()}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(message);
  process.exitCode = 1;
});
