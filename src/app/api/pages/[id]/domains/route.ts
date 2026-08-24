import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dnsPlan } from "@/lib/domains";
import { assertOwns, currentSession } from "@/lib/account";
import { upgradeMessage } from "@/lib/plan";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  await assertOwns(session.accountId, id);
  const domains = await prisma.domain.findMany({ where: { pageId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    domains: domains.map((d) => ({ ...d, plan: dnsPlan(d.hostname) })),
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  await assertOwns(session.accountId, id);
  if (!session.ents.canAttachDomain) {
    return NextResponse.json({ error: upgradeMessage("domain"), upgradeRequired: true }, { status: 402 });
  }
  const body = await req.json().catch(() => ({}));

  const hostname = String(body.hostname ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
    return NextResponse.json({ error: `"${hostname}" is not a hostname.` }, { status: 400 });
  }

  const existing = await prisma.domain.findUnique({ where: { hostname } });
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.pageId === id
            ? "That hostname is already on this page."
            : "That hostname already serves a different page. One hostname, one page.",
      },
      { status: 409 },
    );
  }

  const plan = dnsPlan(hostname);
  const domain = await prisma.domain.create({
    data: { hostname, pageId: id, verified: plan.kind === "wildcard" },
  });

  return NextResponse.json({ domain, plan });
}
