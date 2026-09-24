import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { entitlements, type Entitlements } from "@/lib/plan";
import { appUrl } from "@/lib/hosts";

/**
 * Who an external agent is acting as.
 *
 * The agent API lets something outside this app (another AI agent, a script,
 * an automation) drive one account's workspace with the same tools the chat
 * agent uses. There is no sign-in on that path, so the bearer token IS the
 * account: whoever holds it can build, edit and publish pages as that account.
 *
 * Configured by environment rather than a table on purpose. It is one operator
 * handing one key to their own agents; a deploy is the right amount of friction
 * for minting or revoking it, and it needs no migration.
 *
 *   AGENT_API_KEY     the bearer token. Comma-separate to allow several, so a
 *                     key can be rotated without a window where nothing works.
 *   AGENT_ACCOUNT_ID  the Account.id every call acts as.
 *
 * Either one missing disables the whole API.
 */

export type AgentAuth =
  | { ok: true; accountId: string; ents: Entitlements }
  | { ok: false; status: number; error: string };

function configuredKeys(): string[] {
  return (process.env.AGENT_API_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Hashed first so the comparison is constant-time regardless of length. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function agentApiEnabled(): boolean {
  return configuredKeys().length > 0 && Boolean(process.env.AGENT_ACCOUNT_ID?.trim());
}

export async function authenticateAgent(req: Request): Promise<AgentAuth> {
  const keys = configuredKeys();
  const accountId = process.env.AGENT_ACCOUNT_ID?.trim();
  if (!keys.length || !accountId) {
    return { ok: false, status: 503, error: "The agent API is not configured on this server." };
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-api-key")?.trim() || "";
  // Every key is compared, not just until the first match, so timing does not
  // reveal which of several keys was close.
  const match = presented ? keys.map((k) => sameSecret(presented, k)).some(Boolean) : false;
  if (!match) return { ok: false, status: 401, error: "Unauthorized" };

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, status: 503, error: "AGENT_ACCOUNT_ID does not name an account." };
  if (account.suspended) {
    return { ok: false, status: 403, error: "This account is suspended. Its pages are untouched." };
  }

  return {
    ok: true,
    accountId: account.id,
    ents: entitlements(account.plan, { override: account.maxPages, suspended: account.suspended }),
  };
}

/**
 * Tool results carry app-relative links ("/p/slug?preview=1"), which is right
 * for the chat UI and useless to a caller on another machine. Any string field
 * named *Url that starts with "/" is made absolute.
 */
export function absolutize<T>(value: T, base = appUrl()): T {
  if (Array.isArray(value)) return value.map((v) => absolutize(v, base)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        typeof v === "string" && /url$/i.test(k) && v.startsWith("/") ? `${base}${v}` : absolutize(v, base);
    }
    return out as T;
  }
  return value;
}

/** The tools that call the model, and so spend from the account's key. */
export const GENERATING_TOOLS = new Set(["create_page", "import_page", "generate_variants"]);
