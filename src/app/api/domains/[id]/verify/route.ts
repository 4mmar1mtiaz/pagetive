import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertOwns, currentSession } from "@/lib/account";
import { verifyDomain } from "@/lib/domains";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(session.accountId, domain.pageId);

  const result = await verifyDomain(domain.hostname);
  await prisma.domain.update({
    where: { id },
    data: { verified: result.ok, lastCheck: new Date(), note: result.detail },
  });
  return NextResponse.json(result);
}
