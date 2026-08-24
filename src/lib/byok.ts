import { prisma } from "@/lib/db";

/**
 * Whose Anthropic key pays for a turn.
 *
 * The service is free, and generation is the only part of it that costs real
 * money per use. So the operator's key funds a fixed number of turns to let
 * somebody actually try the thing, and after that an account brings its own.
 * The result is a product that can be given away without an open-ended bill.
 *
 * On storage: the key is kept as given, not encrypted. Encrypting it with a key
 * that lives in the same environment protects against exactly one thing — a
 * stolen database backup — and pretends to protect against more. It is stated
 * plainly in the UI where the key is entered, it is never returned to the
 * client after saving, and it is never logged. If this ever holds keys for
 * people who are not the operator's own customers, move it to a real secrets
 * store rather than adding theatre here.
 */

/** Turns funded by the operator before an account must supply its own key. */
export const FREE_MESSAGES = Number(process.env.FREE_MESSAGES ?? 10);

export type KeyResolution =
  | { ok: true; apiKey: string; own: boolean; remaining: number | null }
  | { ok: false; reason: string; used: number; limit: number };

export async function resolveKey(accountId: string): Promise<KeyResolution> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, reason: "Unknown account.", used: 0, limit: FREE_MESSAGES };

  const own = account.apiKey?.trim();
  if (own) return { ok: true, apiKey: own, own: true, remaining: null };

  const shared = process.env.ANTHROPIC_API_KEY;
  if (!shared) {
    return {
      ok: false,
      reason:
        "No API key is configured. Add your own Anthropic key in settings to start building — it stays on this server and is only used for your own pages.",
      used: account.messagesUsed,
      limit: FREE_MESSAGES,
    };
  }

  if (account.messagesUsed >= FREE_MESSAGES) {
    return {
      ok: false,
      reason: `You have used your ${FREE_MESSAGES} free messages. Adaptive LP is free, but the AI that writes your pages is not, so from here it runs on your own Anthropic key. Paste one in settings and everything keeps working exactly as it did. Your published pages, traffic and reports are unaffected and always will be.`,
      used: account.messagesUsed,
      limit: FREE_MESSAGES,
    };
  }

  return {
    ok: true,
    apiKey: shared,
    own: false,
    remaining: FREE_MESSAGES - account.messagesUsed,
  };
}

/** Only turns on the shared key count. An account on its own key is unmetered. */
export async function countMessage(accountId: string, usedOwnKey: boolean): Promise<void> {
  if (usedOwnKey) return;
  await prisma.account
    .update({ where: { id: accountId }, data: { messagesUsed: { increment: 1 } } })
    .catch(() => undefined);
}

/** Never returned to the client; the UI only ever learns whether one is set. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
