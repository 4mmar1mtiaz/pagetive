import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** What this workspace has spent with Anthropic, in total and per page. */
export async function GET(req: Request) {
  const pageId = new URL(req.url).searchParams.get("page");

  const all = await prisma.usage.aggregate({
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    _count: true,
  });

  const byKind = await prisma.usage.groupBy({
    by: ["kind"],
    _sum: { costUsd: true },
    _count: true,
  });

  const page = pageId
    ? await prisma.usage.aggregate({ where: { pageId }, _sum: { costUsd: true }, _count: true })
    : null;

  return NextResponse.json({
    total: {
      usd: Number((all._sum.costUsd ?? 0).toFixed(4)),
      calls: all._count,
      inputTokens: all._sum.inputTokens ?? 0,
      outputTokens: all._sum.outputTokens ?? 0,
    },
    byKind: byKind.map((k) => ({ kind: k.kind, usd: Number((k._sum.costUsd ?? 0).toFixed(4)), calls: k._count })),
    page: page ? { usd: Number((page._sum.costUsd ?? 0).toFixed(4)), calls: page._count } : null,
  });
}
