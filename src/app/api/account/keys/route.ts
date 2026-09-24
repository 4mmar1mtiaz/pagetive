import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { newAgentKey } from "@/lib/agent-api";

/**
 * The account's own agent API keys (/api/v1).
 *
 * Listing never returns a key, only its prefix: the full key exists in exactly
 * one response, the POST that made it, and after that only its hash is kept.
 * Revoked keys are left out of the list; they are kept in the table for the
 * record, not for the settings screen.
 */

export const dynamic = "force-dynamic";

const NAME_MAX = 60;

export async function GET() {
  const session = await currentSession();
  if (session.anonymous) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const keys = await prisma.apiKey.findMany({
    where: { accountId: session.accountId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const session = await currentSession();
  if (session.anonymous) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give the key a name, so you know which agent has it." }, { status: 400 });
  if (name.length > NAME_MAX) {
    return NextResponse.json({ error: `Keep the name under ${NAME_MAX} characters.` }, { status: 400 });
  }

  const { key, hash, prefix } = newAgentKey();
  const row = await prisma.apiKey.create({
    data: { accountId: session.accountId, name, keyHash: hash, prefix },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
  });
  // The only time the full key leaves the server.
  return NextResponse.json({ key: row, secret: key });
}
