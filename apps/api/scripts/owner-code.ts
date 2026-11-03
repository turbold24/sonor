import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashLinkCode, newLinkCode } from '../src/messenger/owner-messages.js';

// Prints a one-time code that links the shop owner's personal Messenger account to a
// tenant: the owner sends the code to the shop's Page, and Sonor sends them alerts there.
// Only the code's hash is stored, and it stops working after an hour or once used.

const USAGE = 'Usage: pnpm tenant:owner-code --tenant <slug>';
const VALID_MINUTES = 60;

config({ path: ['.env', '../../.env'], quiet: true });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const slug = values.tenant?.trim();
  if (values.help || !slug) {
    console.log(USAGE);
    if (!values.help) process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`No tenant with slug "${slug}".`);
    if (!/^\d+$/.test(tenant.facebookPageId)) {
      throw new Error(
        `Tenant "${slug}" has no Facebook Page yet. Run pnpm tenant:connect-page first.`,
      );
    }

    const code = newLinkCode();
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        ownerLinkCodeHash: hashLinkCode(code),
        ownerLinkExpiresAt: new Date(Date.now() + VALID_MINUTES * 60_000),
      },
    });
    const lines = [
      `Owner link code for "${tenant.name}": ${code}`,
      '',
      `From the owner's personal Facebook account, send exactly this code to the Page`,
      `(m.me/${tenant.facebookPageId}) within ${VALID_MINUTES} minutes. Sonor replies to confirm,`,
      'then sends handoff and paid-order alerts to that account.',
    ];
    if (tenant.ownerPsid) {
      lines.push('Once used, it replaces the owner account linked now.');
    }
    console.log(lines.join('\n'));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
