import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  const pages = await prisma.page.findMany({
    where: { ownerId: session.accountId },
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
      updatedAt: p.updatedAt,
    })),
  });
}
