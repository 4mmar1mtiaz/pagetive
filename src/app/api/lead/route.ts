import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseJson, toJson } from "@/lib/json";
import type { PageSettings } from "@/lib/blocks";
import { deliverLead } from "@/lib/notify";
import { clientIp, rateLimit } from "@/lib/ratelimit";

/**
 * Form submission.
 *
 * Order is deliberate and load-bearing: persist first, count the conversion,
 * then attempt delivery. If the CRM webhook is wrong the lead still exists in
 * the database with the reason attached, and the visitor still sees a thank
 * you. The alternative — forward first, save if it worked — throws away exactly
 * the leads the owner most needs to know about.
 *
 * Three cheap spam defences run before any of that. They matter more here than
 * on a normal contact form: a junk submission does not just dirty the CRM, it
 * counts as a conversion, and conversions are what the optimizer learns from.
 * Enough bot traffic and the page starts genuinely optimising itself toward
 * whichever variant the bots happened to land on.
 *
 *   1. A honeypot field no human can see or tab into.
 *   2. A minimum time on the form. Humans do not fill three fields in a second.
 *   3. A per-IP flood limit.
 *
 * The first two are certainties and their submissions are discarded. The third
 * is not, and is treated differently on purpose: an IP address is a terrible
 * identifier for a person. Mobile carriers put thousands of subscribers behind
 * one address, and offices put a whole company behind one — so on a page whose
 * traffic is mostly phones, a tight per-IP quota rejects real buyers. Over the
 * limit, the lead is therefore STORED and flagged, just not forwarded and not
 * counted as a conversion. Nothing is ever thrown away on suspicion alone, and
 * the optimizer never learns from a submission we did not trust.
 *
 * Every rejected path returns success. Telling a bot why it failed only tells
 * it what to change.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    pageId?: string;
    variantId?: string | null;
    blockId?: string;
    data?: Record<string, string>;
    url?: string;
    visitorId?: string;
    sessionId?: string;
    /** Honeypot. Any value at all means it was not a person. */
    _hp?: string;
    /** Milliseconds between the form rendering and this submit. */
    _elapsed?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { pageId } = body;
  const data = body.data ?? {};
  if (!pageId || Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to submit" }, { status: 400 });
  }

  // Silent drops. The response is indistinguishable from success on purpose.
  if (body._hp) return NextResponse.json({ ok: true });
  if (typeof body._elapsed === "number" && body._elapsed >= 0 && body._elapsed < 1500) {
    return NextResponse.json({ ok: true });
  }

  // Deliberately loose. This is a flood guard, not a quota: a script sending
  // thousands trips it long before a shared office or carrier address does.
  const ip = clientIp(req);
  const burst = rateLimit(`lead:${ip}`, 8, 60 * 1000);
  const hourly = rateLimit(`lead-hour:${ip}`, 40, 60 * 60 * 1000);
  const suspect = !burst.ok || !hourly.ok;

  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) return NextResponse.json({ error: "Unknown page" }, { status: 404 });

  const variantId = body.variantId || null;

  const lead = await prisma.lead.create({
    data: { pageId, variantId, data: toJson(data), suspect },
  });

  // A flagged lead stops here: it is on the record and visible in the report,
  // but it does not move the conversion count, does not reach the CRM, and
  // does not teach the optimizer anything.
  if (suspect) return NextResponse.json({ ok: true });

  if (variantId) {
    await prisma.variant
      .update({ where: { id: variantId }, data: { conversions: { increment: 1 } } })
      .catch(() => undefined);
  }

  // The conversion event is written here rather than by the tracker: this is
  // the only place that knows the submit actually succeeded, and it keeps the
  // number honest when a visitor's browser blocks the tracker entirely.
  await prisma.event.create({
    data: {
      pageId,
      variantId,
      visitorId: body.visitorId ?? "anon",
      sessionId: body.sessionId ?? lead.id,
      type: "conversion",
      blockId: body.blockId ?? null,
      meta: toJson({ leadId: lead.id }),
    },
  });

  const settings = parseJson<PageSettings>(page.settings, {});
  const delivery = await deliverLead({
    settings,
    pageName: page.name,
    data,
    context: {
      _leadId: lead.id,
      _variantId: variantId,
      _submittedAt: new Date().toISOString(),
      _url: body.url ?? "",
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { forwarded: delivery.forwarded, forwardError: delivery.error ?? null },
  });

  return NextResponse.json({ ok: true, redirect: settings.redirectUrl ?? null });
}
