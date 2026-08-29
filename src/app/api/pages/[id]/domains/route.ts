import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dnsPlan } from "@/lib/domains";
import { assertOwns, currentSession } from "@/lib/account";
import { upgradeMessage } from "@/lib/plan";
import { attachHostname } from "@/lib/platform";

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

  // Register with whatever is serving HTTPS in front of this app, now, rather
  // than leaving it as a step somebody has to know about. Without it the
  // hostname resolves, answers 404, and has no certificate — which looks
  // exactly like a product that does not work.
  const platform = await attachHostname(hostname);

  const domain = await prisma.domain.create({
    data: {
      hostname,
      pageId: id,
      verified: plan.kind === "wildcard",
      note: platform.noop ? null : platform.detail,
    },
  });

  return NextResponse.json({ domain, plan, platform });
}
