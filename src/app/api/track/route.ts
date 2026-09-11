import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/**
 * Event ingestion.
 *
 * Two rules:
 *   - Never fail loudly. This endpoint is called from a stranger's browser on
 *     the customer's paid traffic; a 500 here must not surface anywhere near
 *     the visitor, so anything unexpected returns 204 and is dropped.
 *   - Count an impression once per session, not once per event batch. The
 *     bandit divides conversions by impressions, so an inflated denominator
 *     would quietly make every variant look worse than it is.
 */

export const dynamic = "force-dynamic";

type Incoming = {
  pageId?: string;
  variantId?: string | null;
  visitorId?: string;
  sessionId?: string;
  events?: {
    type?: string;
    blockId?: string | null;
    x?: number;
    y?: number;
    value?: number;
    meta?: Record<string, unknown>;
  }[];
};

const ALLOWED = new Set(["view", "click", "cta", "scroll", "dwell", "form_start", "conversion"]);

export async function POST(req: Request) {
  let body: Incoming;
  try {
    body = (await req.json()) as Incoming;
  } catch {
    return new Response(null, { status: 204 });
  }

  // Generous — a real session sends a handful of batches — but it stops a
  // script inflating impressions, which would quietly skew every conversion
  // rate on the page downward.
  if (!rateLimit(`track:${clientIp(req)}`, 60, 60 * 1000).ok) {
    return new Response(null, { status: 204 });
  }

  const { pageId, sessionId } = body;
  const visitorId = body.visitorId || "anon";
  if (!pageId || !sessionId || !Array.isArray(body.events) || body.events.length === 0) {
    return new Response(null, { status: 204 });
  }

  try {
    const page = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
    if (!page) return new Response(null, { status: 204 });

    const variantId = body.variantId || null;
    const rows = body.events
      .filter((e) => e.type && ALLOWED.has(e.type))
      // 200 is far more than a real session produces; anything above it is a
      // loop or a script, and writing it would distort every average.
      .slice(0, 200)
      .map((e) => ({
        pageId,
        variantId,
        visitorId,
        sessionId,
        type: e.type as string,
        blockId: e.blockId ?? null,
        x: typeof e.x === "number" ? e.x : null,
        y: typeof e.y === "number" ? e.y : null,
        value: typeof e.value === "number" ? e.value : null,
        meta: toJson(e.meta ?? {}),
      }));

    if (rows.length === 0) return new Response(null, { status: 204 });

    const hasView = rows.some((r) => r.type === "view");
    if (hasView && variantId) {
      const alreadyCounted = await prisma.event.count({
        where: { pageId, sessionId, type: "view" },
      });
      if (alreadyCounted === 0) {
        await prisma.variant.update({
          where: { id: variantId },
          data: { impressions: { increment: 1 } },
        });
      }
    }

    await prisma.event.createMany({ data: rows });
  } catch {
    // Deliberately silent. Losing an event is acceptable; breaking a live
    // landing page because analytics had a bad minute is not.
    return new Response(null, { status: 204 });
  }

  return new Response(null, { status: 204 });
}
