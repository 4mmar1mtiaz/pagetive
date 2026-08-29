import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertOwns, currentSession } from "@/lib/account";
import { detachHostname } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  const domain = await prisma.domain.findUnique({ where: { id }, select: { pageId: true, hostname: true } });
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(session.accountId, domain.pageId);
  await prisma.domain.delete({ where: { id } });
  // After the row, and never allowed to fail the delete: a hostname left on
  // the platform is untidy, a page nobody can detach is broken.
  await detachHostname(domain.hostname);
  return NextResponse.json({ ok: true });
}
