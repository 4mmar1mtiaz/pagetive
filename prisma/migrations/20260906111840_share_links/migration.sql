-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "withReport" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageGrant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Share_token_key" ON "Share"("token");

-- CreateIndex
CREATE INDEX "Share_pageId_idx" ON "Share"("pageId");

-- CreateIndex
CREATE INDEX "PageGrant_accountId_idx" ON "PageGrant"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PageGrant_pageId_accountId_key" ON "PageGrant"("pageId", "accountId");

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
