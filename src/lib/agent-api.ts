import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
 * Two kinds of key are accepted, checked in this order:
 *
 *   1. The operator's environment key, as before. One key (or a comma list, for
 *      rotation) that acts as one fixed account:
 *
 *        AGENT_API_KEY     the bearer token(s).
 *        AGENT_ACCOUNT_ID  the Account.id every call with it acts as.
 *
 *      Checked first and without touching the ApiKey table, so it keeps working
 *      exactly as it did even on a database the ApiKey migration has not
 *      reached yet. Either value missing just switches this path off.
 *
 *   2. An account's own key, made from the settings panel. `pgt_` plus 64 hex
 *      characters, stored only as a sha256 and looked up by it. It acts as the
 *      account that made it, until that account revokes it.
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

/** What an account key looks like. Anything else is never looked up. */
const ACCOUNT_KEY = /^pgt_[0-9a-f]{64}$/;

/** What is stored for a key, and what a presented key is looked up by. */
export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * A fresh account key: 32 bytes of real randomness, hex encoded. The caller
 * stores `hash` and `prefix` and shows `key` to the user once.
 */
export function newAgentKey(): { key: string; hash: string; prefix: string } {
  const key = `pgt_${randomBytes(32).toString("hex")}`;
  return { key, hash: hashAgentKey(key), prefix: key.slice(0, 12) };
}

/** Whether the operator's environment key is set. Account keys need no setup. */
export function agentApiEnabled(): boolean {
  return configuredKeys().length > 0 && Boolean(process.env.AGENT_ACCOUNT_ID?.trim());
}

function authed(account: { id: string; plan: string; maxPages: number | null; suspended: boolean }): AgentAuth {
  if (account.suspended) {
    return { ok: false, status: 403, error: "This account is suspended. Its pages are untouched." };
  }
  return {
    ok: true,
    accountId: account.id,
    ents: entitlements(account.plan, { override: account.maxPages, suspended: account.suspended }),
  };
}

export async function authenticateAgent(req: Request): Promise<AgentAuth> {
  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-api-key")?.trim() || "";
  if (!presented) return { ok: false, status: 401, error: "Unauthorized" };

  // 1. The operator's environment key. Every key is compared, not just until
  // the first match, so timing does not reveal which of several keys was close.
  const keys = configuredKeys();
  const accountId = process.env.AGENT_ACCOUNT_ID?.trim();
  if (keys.length && accountId && keys.map((k) => sameSecret(presented, k)).some(Boolean)) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return { ok: false, status: 503, error: "AGENT_ACCOUNT_ID does not name an account." };
    return authed(account);
  }

  // 2. An account's own key. The lookup is by hash, so the stored value never
  // has to be compared against the presented one at all.
  if (!ACCOUNT_KEY.test(presented)) return { ok: false, status: 401, error: "Unauthorized" };

  let row;
  try {
    row = await prisma.apiKey.findUnique({
      where: { keyHash: hashAgentKey(presented) },
      include: { account: true },
    });
  } catch {
    // The table not existing yet (migration not applied) must read as a bad
    // key, not a crash, so nothing about path 1 depends on it.
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!row || row.revokedAt) return { ok: false, status: 401, error: "Unauthorized" };

  const result = authed(row.account);
  if (result.ok) {
    // Best effort: a failed timestamp write is no reason to refuse the call.
    await prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return result;
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
