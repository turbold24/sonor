import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { encryptSecret, parseEncryptionKey } from '../src/common/encryption.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { GraphClient, GraphError } from '../src/messenger/graph.client.js';
import { loadMessengerConfig } from '../src/messenger/messenger.config.js';

// Connects a Facebook Page to a tenant: checks the Page access token with the Graph
// API, then stores the Page ID and the token, encrypted. The token is read from
// PAGE_ACCESS_TOKEN or typed at a prompt that doesn't echo it, and is never printed.

const USAGE = `Usage: pnpm tenant:connect-page --tenant <slug> --page-id <id> [--subscribe] [--skip-check]

The Page access token is read from PAGE_ACCESS_TOKEN, or asked for without echoing it.

  --subscribe   Also subscribe the app to this Page's messages, messaging_postbacks
                and message_echoes webhook fields.
  --skip-check  Don't check the token with the Graph API first.`;

const WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'message_echoes'];

config({ path: ['.env', '../../.env'], quiet: true });

class UsageError extends Error {}

async function readToken(): Promise<string> {
  const fromEnv = process.env.PAGE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  if (!stdin.isTTY) {
    let piped = '';
    for await (const chunk of stdin) piped += String(chunk);
    return piped.trim();
  }

  stdout.write('Page access token (input hidden): ');
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const prompt = createInterface({
    input: stdin,
    output: muted,
    terminal: true,
  });
  try {
    return (await prompt.question('')).trim();
  } finally {
    prompt.close();
    stdout.write('\n');
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      tenant: { type: 'string' },
      'page-id': { type: 'string' },
      subscribe: { type: 'boolean', default: false },
      'skip-check': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const slug = values.tenant?.trim();
  const pageId = values['page-id']?.trim();
  if (!slug || !pageId) throw new UsageError(USAGE);
  if (!/^\d+$/.test(pageId)) {
    throw new UsageError('--page-id must be the numeric Facebook Page ID.');
  }

  const token = await readToken();
  if (!token) throw new UsageError('No Page access token was given.');
  const key = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  const messenger = loadMessengerConfig((name) => process.env[name]);
  const graph = new GraphClient({
    version: messenger.graphVersion,
    appSecret: messenger.appSecret,
  });

  if (!values['skip-check']) {
    const page = await graph.page(token);
    if (page.id !== pageId) {
      throw new UsageError(
        `That token belongs to Page "${page.name}" (${page.id}), not ${pageId}.`,
      );
    }
    console.log(`The token is valid for Page "${page.name}" (${page.id}).`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new UsageError(`No tenant with slug "${slug}".`);
    const other = await prisma.tenant.findUnique({
      where: { facebookPageId: pageId },
    });
    if (other && other.id !== tenant.id) {
      throw new UsageError(
        `Page ${pageId} is already connected to tenant "${other.slug}".`,
      );
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        facebookPageId: pageId,
        pageAccessTokenEncrypted: encryptSecret(token, key),
      },
    });
    console.log(
      `Connected Page ${pageId} to tenant "${slug}". The token is stored encrypted.`,
    );
  } finally {
    await prisma.$disconnect();
  }

  if (values.subscribe) {
    await graph.subscribePage(pageId, token, WEBHOOK_FIELDS);
    console.log(`Subscribed the app to ${WEBHOOK_FIELDS.join(', ')}.`);
  }
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
