/**
 * A sliding-window limiter, in memory.
 *
 * In memory means per instance: two servers behind a load balancer each allow
 * the full budget, and a restart forgets everything. On a single long-lived
 * server that is a fine trade, because the job is to stop a script hammering a
 * public endpoint rather than to enforce a quota to the request.
 *
 * On serverless it is close to useless, since an attacker's requests land on
 * fresh instances. So this is now the cheap first line only, and the lead
 * endpoint additionally counts prior submissions in the database, which is
 * correct on any number of instances. See countRecentByIp below.
 */

type Window = { hits: number[]; };

const buckets = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired keys occasionally so a long-lived process does not grow forever. */
function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60000) return;
  lastSweep = now;
  for (const [key, w] of buckets) {
    if (w.hits.every((t) => now - t > windowMs)) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryIn: number } {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return { ok: false, retryIn: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryIn: 0 };
}

/**
 * Best-effort client address.
 *
 * Behind a proxy the socket address is the proxy, so the forwarded headers are
 * all there is. They are trivially spoofable, which is exactly why they gate a
 * rate limit and nothing else — never authorisation.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}


/** Salted so the table never contains anything that reverses to an address. */
export async function hashIp(ip: string): Promise<string> {
  const salt = process.env.IP_HASH_SALT ?? "adaptive-lp";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * How many leads this source has submitted recently, counted in the database.
 *
 * The in-memory limiter above cannot see across instances, and on a serverless
 * host every request may be a new instance. This costs one indexed count per
 * submission and is the check that actually holds when the app is running in
 * more than one place at once.
 */
export async function countRecentByIp(ipHash: string, withinMs: number): Promise<number> {
  const { prisma } = await import("@/lib/db");
  return prisma.lead.count({
    where: { ipHash, createdAt: { gte: new Date(Date.now() - withinMs) } },
  });
}
