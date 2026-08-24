import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { FREE_MESSAGES, maskKey } from "@/lib/byok";

/**
 * The account's own settings, which today is one thing: whose key pays.
 *
 * The stored key is never returned, only a mask of it. There is no legitimate
 * reason for the browser to read it back, and "the settings screen shows your
 * key so you can check it" is how a key ends up in a screenshot.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (session.anonymous) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const account = await prisma.account.findUnique({ where: { id: session.accountId } });
  return NextResponse.json({
    email: session.email,
    plan: session.plan,
    hasOwnKey: Boolean(account?.apiKey),
    keyHint: maskKey(account?.apiKey),
    messagesUsed: account?.messagesUsed ?? 0,
    freeMessages: FREE_MESSAGES,
    freeRemaining: Math.max(0, FREE_MESSAGES - (account?.messagesUsed ?? 0)),
  });
}

export async function PUT(req: Request) {
  const session = await currentSession();
  if (session.anonymous) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const apiKey = String(body.apiKey ?? "").trim();

  if (!apiKey) {
    await prisma.account.update({ where: { id: session.accountId }, data: { apiKey: null } });
    return NextResponse.json({ ok: true, hasOwnKey: false });
  }

  // Shape check only. Whether it works is answered by the first real call, and
  // a probe request here would cost the user money to validate a text field.
  if (!apiKey.startsWith("sk-ant-") || apiKey.length < 40) {
    return NextResponse.json(
      { error: "That does not look like an Anthropic key. They start with sk-ant- and are longer than this." },
      { status: 400 },
    );
  }

  await prisma.account.update({ where: { id: session.accountId }, data: { apiKey } });
  return NextResponse.json({ ok: true, hasOwnKey: true, keyHint: maskKey(apiKey) });
}
