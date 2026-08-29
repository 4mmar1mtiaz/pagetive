import { PrismaClient } from "@prisma/client";

// Singleton so Next's dev hot-reload doesn't open a new pool per edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Guarantee the pool is big enough for the pages that use it.
 *
 * Managed Postgres hands out a pooler URL, and some of them carry
 * `connection_limit=1`. That is fine for a request making one query and fatal
 * for anything reading several tables at once — the report fans out a dozen
 * reads, the first takes the only connection, the rest queue, and after ten
 * seconds Prisma gives up with P2024. The page 500s with an error that says
 * nothing about connection limits, so it reads as the app being broken.
 *
 * A pooler multiplexes these onto far fewer server connections, so a larger
 * client-side pool costs nothing upstream. Rather than depend on every
 * deployment being configured correctly, raise anything below the floor.
 *
 * Serverless inverts this completely. There, each concurrent invocation is its
 * own process with its own pool, so a floor of ten means fifty concurrent
 * requests try to hold five hundred connections and the database refuses them
 * all. On a serverless host the correct client-side pool is small and the
 * pooler does the multiplexing, so the floor is not applied at all.
 */
const POOL_FLOOR = 10;

/** Vercel and similar set this; a long-lived container does not. */
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function connectionUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (SERVERLESS) return raw; // whatever the pooler URL says, it is right
  try {
    const url = new URL(raw);
    const current = Number(url.searchParams.get("connection_limit"));
    if (!Number.isFinite(current) || current < POOL_FLOOR) {
      url.searchParams.set("connection_limit", String(POOL_FLOOR));
      return url.toString();
    }
    return raw;
  } catch {
    // Not parseable — hand it to Prisma untouched and let it complain with a
    // better message than we could write here.
    return raw;
  }
}

function makeClient(): PrismaClient {
  const url = connectionUrl();
  return url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
