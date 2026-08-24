/**
 * A sliding-window limiter, in memory.
 *
 * In memory means per instance: two servers behind a load balancer each allow
 * the full budget, and a restart forgets everything. That is a real weakness
 * and it is still the right trade here — the job is to stop a script hammering
 * a public endpoint, not to enforce a quota to the request. Nothing depends on
 * the count being exact, and the alternative is a Redis dependency for one
 * feature on a product that currently needs no external services at all.
 *
 * Swap the two functions for a shared store the day this runs on more than one
 * instance and the limits actually matter.
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
