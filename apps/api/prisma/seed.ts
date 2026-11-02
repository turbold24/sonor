import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { encryptSecret, parseEncryptionKey } from '../src/common/encryption.js';
import { ConnectorType, PrismaClient } from '../src/generated/prisma/client.js';
import { demoTenants } from './demo-data.js';

config({ path: ['.env', '../../.env'], quiet: true });

// Placeholder only. A real Page token is set on a tenant outside the seed and never committed.
const PLACEHOLDER_PAGE_TOKEN = 'demo-placeholder-not-a-real-token';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const key = parseEncryptionKey(process.env.ENCRYPTION_KEY);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const { products, facebookPageId, ...profile } of demoTenants) {
      // On re-runs, keep the Page ID and token: they may have been pointed at a real test Page.
      const tenant = await prisma.tenant.upsert({
        where: { slug: profile.slug },
        create: {
          ...profile,
          facebookPageId,
          connectorType: ConnectorType.DEMO,
          pageAccessTokenEncrypted: encryptSecret(PLACEHOLDER_PAGE_TOKEN, key),
        },
        update: profile,
      });

      // Replace the catalog wholesale so the seed is safe to re-run.
      await prisma.$transaction([
        prisma.product.deleteMany({ where: { tenantId: tenant.id } }),
        prisma.product.createMany({
          data: products.map((product) => ({
            ...product,
            tenantId: tenant.id,
          })),
        }),
      ]);

      console.log(
        `Seeded ${tenant.name} (${tenant.slug}): ${products.length} products`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
