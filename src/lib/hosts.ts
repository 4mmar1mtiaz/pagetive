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

  // Vercel hands out a fresh hostname for every deployment, so no configured
  // value can ever name them all. An unrecognised host is treated as a
  // customer domain and rewritten to /h/{host}, which means one stale APP_URL
  // turns the product's own front door into a lookup for a domain nobody
  // registered. Both variables are injected by the platform, so this needs no
  // dashboard setup and is inert anywhere else.
  for (const key of ["VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL"]) {
    const value = process.env[key]?.trim().toLowerCase();
    if (value) hosts.push(value.replace(/^https?:\/\//, "").split("/")[0]);
  }

  return hosts;
}

/**
 * The public base URL to print in links, snippets and DNS instructions.
 *
 * APP_URL is authoritative, with one exception: a localhost value that has
 * followed the app into a deployment is a development leftover, not an
 * instruction, and honouring it puts "http://localhost:4400" into export links
 * and published URLs that other people are meant to open. Where the platform
 * tells us its own hostname, that is the truthful answer.
 */
export function appUrl(): string {
  const configured = process.env.APP_URL?.trim();
  const platform = (
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    ""
  ).trim();
  const isLocal = !configured || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(configured);
  if (isLocal && platform) {
    return `https://${platform.replace(/^https?:\/\//, "").split("/")[0]}`;
  }
  return configured || "http://localhost:4400";
}

/**
 * Root you own and have pointed a wildcard at, e.g. "lp.yourdomain.com".
 *
 * Written without the star. Everyone types the star anyway, because the DNS
 * record they just created was "*.lp.yourdomain.com" and that is the string in
 * front of them. Left unstripped it poisons everything downstream: the suffix
 * test becomes endsWith(".*.lp.yourdomain.com") and never matches, the CNAME
 * the customer is told to create points at a hostname with a star in it, and
 * verification can only ever fail. Strip it here, once.
 */
export function wildcardRoot(): string | null {
  const raw = process.env.WILDCARD_ROOT?.trim().toLowerCase();
  if (!raw) return null;
  const root = raw
    .replace(/^\*+\.?/, "")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  return root || null;
}
