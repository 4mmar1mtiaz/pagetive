import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { grantedPageIds } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();

  // Pages somebody shared with this account sit in the same list as their own.
  // A separate "Shared with me" section would be tidier and worse: you would
  // have to remember which half of the sidebar a page lives in before you could
  // find it. They carry a flag instead, and the UI marks them.
  const granted = await grantedPageIds(session.accountId);
  const pages = await prisma.page.findMany({
    where: session.accountId
      ? { OR: [{ ownerId: session.accountId }, { id: { in: granted } }] }
      : { id: { in: [] } },
    orderBy: { updatedAt: "desc" },
    include: { variants: true, _count: { select: { leads: true } } },
  });
  return NextResponse.json({
    plan: {
      name: session.plan,
      ...session.ents,
      pagesCreated: session.pagesCreated,
      isAdmin: session.isAdmin,
      suspended: session.suspended,
    },
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      source: p.source,
      variants: p.variants.length,
      impressions: p.variants.reduce((n, v) => n + v.impressions, 0),
      conversions: p.variants.reduce((n, v) => n + v.conversions, 0),
      leads: p._count.leads,
      /** True when this account was given the page rather than building it. */
      shared: p.ownerId !== session.accountId,
      updatedAt: p.updatedAt,
    })),
  });
}
