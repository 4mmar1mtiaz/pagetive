#!/usr/bin/env node
/**
 * Register a page record for traffic this app does not serve.
 *
 * The tracker posts events keyed by pageId, and /api/track drops anything whose
 * page does not exist. An externally hosted site therefore needs one row here
 * before its events have somewhere to land. One row covers a whole corpus of
 * external pages: the host names each visitor through data-visitor, so the
 * funnel aggregates across them and a single visitor is still recoverable.
 *
 *   node --env-file=.env.local scripts/register-embed-page.mjs <slug> "<name>"
 *
 * Prints the page id to embed. Re-running with the same slug is a no-op that
 * prints the existing id, so it is safe in a deploy script.
 */
import { PrismaClient } from "@prisma/client";

const [slug, name] = process.argv.slice(2);
if (!slug) {
  console.error('usage: node --env-file=.env.local scripts/register-embed-page.mjs <slug> "<name>"');
  process.exit(1);
}

const prisma = new PrismaClient();

const existing = await prisma.page.findUnique({ where: { slug }, select: { id: true, name: true } });
if (existing) {
  console.log(`${existing.id}\t(existing: ${existing.name})`);
} else {
  const owner = await prisma.account.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  const page = await prisma.page.create({
    data: {
      slug,
      name: name || slug,
      status: "live",
      source: "import",
      goal: "Externally hosted pages reporting into this account's analytics.",
      ...(owner ? { ownerId: owner.id } : {}),
    },
    select: { id: true, ownerId: true },
  });
  console.log(`${page.id}\t(created, owner ${page.ownerId})`);
}

await prisma.$disconnect();
