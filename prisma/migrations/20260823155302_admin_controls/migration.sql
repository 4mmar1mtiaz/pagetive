-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "maxPages" INTEGER,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "suspended" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "accountId" TEXT;

-- CreateIndex
CREATE INDEX "Usage_accountId_idx" ON "Usage"("accountId");
