-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local',
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "goal" TEXT NOT NULL DEFAULT '',
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "theme" TEXT NOT NULL DEFAULT '{}',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'chat',
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "angle" TEXT NOT NULL DEFAULT '',
    "match" TEXT NOT NULL DEFAULT '{}',
    "overrides" TEXT NOT NULL DEFAULT '{}',
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "variantId" TEXT,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "blockId" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "variantId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "forwardError" TEXT,
    "suspect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "blocks" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL DEFAULT 'local',
    "title" TEXT NOT NULL DEFAULT 'New page',
    "pageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT,
    "pageId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheRead" INTEGER NOT NULL DEFAULT 0,
    "cacheWrite" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastCheck" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "email" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "pagesCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Page_slug_key" ON "Page"("slug");

-- CreateIndex
CREATE INDEX "Page_status_idx" ON "Page"("status");

-- CreateIndex
CREATE INDEX "Page_ownerId_idx" ON "Page"("ownerId");

-- CreateIndex
CREATE INDEX "Variant_pageId_active_idx" ON "Variant"("pageId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_pageId_visitorId_key" ON "Assignment"("pageId", "visitorId");

-- CreateIndex
CREATE INDEX "Event_pageId_type_idx" ON "Event"("pageId", "type");

-- CreateIndex
CREATE INDEX "Event_pageId_createdAt_idx" ON "Event"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_pageId_createdAt_idx" ON "Lead"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Chat_ownerId_idx" ON "Chat"("ownerId");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "Usage_pageId_idx" ON "Usage"("pageId");

-- CreateIndex
CREATE INDEX "Usage_createdAt_idx" ON "Usage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_pageId_idx" ON "Domain"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_clerkUserId_key" ON "Account"("clerkUserId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
