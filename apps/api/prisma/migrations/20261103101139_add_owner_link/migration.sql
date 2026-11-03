-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ownerLinkCodeHash" TEXT,
ADD COLUMN     "ownerLinkExpiresAt" TIMESTAMP(3),
ADD COLUMN     "ownerPsid" TEXT;

