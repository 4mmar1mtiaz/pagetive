-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "apiKey" TEXT,
ADD COLUMN     "messagesUsed" INTEGER NOT NULL DEFAULT 0;
