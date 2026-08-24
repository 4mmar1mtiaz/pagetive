-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "ipHash" TEXT;

-- CreateIndex
CREATE INDEX "Lead_ipHash_createdAt_idx" ON "Lead"("ipHash", "createdAt");
