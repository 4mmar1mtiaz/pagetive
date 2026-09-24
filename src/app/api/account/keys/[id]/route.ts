import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";

/**
 * Revoke one of the account's agent API keys.
 *
 * Scoped by account in the same query that revokes, so an id belonging to
 * someone else matches nothing and reads as "not found" rather than as a hint
 * that the key exists.
 */

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (session.anonymous) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const { count } = await prisma.apiKey.updateMany({
    where: { id, accountId: session.accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
