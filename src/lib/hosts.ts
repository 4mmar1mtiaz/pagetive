/**
 * Which hostnames belong to the app itself.
 *
 * Kept in its own module with no Node imports because the proxy runs in the
 * edge runtime and importing anything that reaches for `node:dns` there fails
 * the build.
 */

/** The host this app answers on. Everything else is a customer hostname. */
export function appHosts(): string[] {
  const hosts = ["localhost", "127.0.0.1"];
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      hosts.push(new URL(appUrl).hostname.toLowerCase());
    } catch {
      /* a malformed APP_URL should not break routing */
    }
  }
  const extra = process.env.APP_HOSTS;
  if (extra) hosts.push(...extra.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
  return hosts;
}

/** Root you own and have pointed a wildcard at, e.g. "lp.yourdomain.com". */
export function wildcardRoot(): string | null {
  return process.env.WILDCARD_ROOT?.trim().toLowerCase() || null;
}
