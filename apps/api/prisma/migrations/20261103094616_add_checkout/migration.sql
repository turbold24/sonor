
-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'DEMO';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "options" JSONB;

-- AlterTable
ALTER TABLE "PaymentLink" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_token_key" ON "PaymentLink"("token");
