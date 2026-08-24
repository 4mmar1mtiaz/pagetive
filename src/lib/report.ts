import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { normalizeBlocks, type Block } from "@/lib/blocks";
import { EXPLORE_MIN, winProbabilities, type Arm } from "@/lib/bandit";

/**
 * The per-page report.
 *
 * Computed from raw events on every request rather than from rollup tables.
 * That is a deliberate trade while pages are small: the numbers are always
 * exactly what happened, with no aggregation job to be stale or wrong, and
 * there is no second definition of "a visitor" to drift out of step. Past a
 * few hundred thousand events on one page this needs a nightly rollup — the
 * cap below stops it from hanging the page in the meantime.
 *
 * Everything is counted in UNIQUE VISITORS, not events. A funnel counted in
 * events flatters itself: one person scrolling up and down produces six scroll
 * events and looks like six people reaching the bottom.
 */

const EVENT_CAP = 300000;

export type RangeKey = "7d" | "30d" | "90d" | "all" | "custom";

export type Range = { from: Date; to: Date; key: RangeKey; label: string; days: number };

export function resolveRange(key: string | undefined, fromRaw?: string, toRaw?: string): Range {
  const now = new Date();
  const end = new Date(now.getTime());

  if (key === "custom" && fromRaw) {
    const from = new Date(`${fromRaw}T00:00:00`);
    const to = toRaw ? new Date(`${toRaw}T23:59:59`) : end;
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
    return { from, to, key: "custom", label: `${fromRaw} → ${toRaw ?? "now"}`, days };
  }

  if (key === "all") {
    return { from: new Date(0), to: end, key: "all", label: "All time", days: 0 };
  }

  const days = key === "90d" ? 90 : key === "7d" ? 7 : 30;
  const from = new Date(end.getTime() - days * 86400000);
  return { from, to: end, key: (key as RangeKey) ?? "30d", label: `Last ${days} days`, days };
}

export type FunnelStep = {
  step: string;
  explain: string;
  visitors: number;
  /** Share of everyone who landed. */
  ofTop: number;
  /** Share of the previous step who made it here. */
  ofPrev: number;
};

export type Report = {
  range: { from: string; to: string; label: string; key: RangeKey };
  totals: {
    visitors: number;
    views: number;
    returning: number;
    conversions: number;
    cvr: number;
    leads: number;
    /** Median seconds on page, from summed block attention. */
    medianSeconds: number;
  };
  /** Same window, immediately before this one. Null when there is no history. */
  previous: { visitors: number; conversions: number; cvr: number } | null;
  funnel: FunnelStep[];
  daily: { date: string; visitors: number; conversions: number }[];
  variants: {
    id: string;
    name: string;
    angle: string;
    isControl: boolean;
    active: boolean;
    targeted: boolean;
    visitors: number;
    conversions: number;
    cvr: number;
    winProbability: number;
    flag: "starved" | "winning" | "losing" | "testing";
  }[];
  sources: { label: string; kind: string; visitors: number; conversions: number; cvr: number }[];
  devices: { label: string; visitors: number; conversions: number; cvr: number }[];
  sections: {
    blockId: string;
    type: string;
    label: string;
    reach: number;
    dwellSeconds: number;
    clicks: number;
    ctaClicks: number;
    heat: number;
  }[];
  scroll: { depth: number; share: number }[];
  leads: {
    at: string;
    data: Record<string, string>;
    forwarded: boolean;
    suspect: boolean;
    variant: string | null;
  }[];
};

type Meta = { ref?: string; q?: string; w?: number; label?: string };

/** Where this visit came from, best effort, in the order a marketer would ask. */
function sourceOf(meta: Meta): { label: string; kind: string } {
  const q = new URLSearchParams(meta.q ?? "");
  const content = q.get("utm_content");
  const campaign = q.get("utm_campaign");
  const source = q.get("utm_source");
  const seg = q.get("seg");

  if (content) return { label: content, kind: "ad / content" };
  if (campaign) return { label: campaign, kind: "campaign" };
  if (seg) return { label: seg, kind: "segment" };
  if (source) return { label: source, kind: "source" };

  const ref = (meta.ref ?? "").trim();
  if (ref) {
    try {
      return { label: new URL(ref).hostname.replace(/^www\./, ""), kind: "referrer" };
    } catch {
      return { label: ref.slice(0, 40), kind: "referrer" };
    }
  }
  return { label: "Direct / unknown", kind: "direct" };
}

function deviceOf(meta: Meta): string {
  const w = meta.w ?? 0;
  if (!w) return "Unknown";
  if (w < 640) return "Mobile";
  if (w < 1024) return "Tablet";
  return "Desktop";
}

function rate(conversions: number, visitors: number): number {
  return visitors > 0 ? conversions / visitors : 0;
}

export async function pageReport(
  pageId: string,
  opts: { range: Range; variantId?: string | null },
): Promise<Report> {
  const { range, variantId } = opts;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
  if (!page) throw new Error("Page not found");

  const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));
  const goalBlock = blocks.find((b) => b.type === "form" || b.type === "calendar");

  const where = {
    pageId,
    ...(variantId ? { variantId } : {}),
    createdAt: { gte: range.from, lte: range.to },
  };

  const events = await prisma.event.findMany({
    where,
    select: {
      type: true,
      blockId: true,
      variantId: true,
      visitorId: true,
      sessionId: true,
      value: true,
      meta: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: EVENT_CAP,
  });

  /* ---- unique-visitor sets, which every number below is built from ---- */
  const landed = new Set<string>();
  const scrolled = new Set<string>();
  const reachedGoal = new Set<string>();
  const clickedCta = new Set<string>();
  const startedForm = new Set<string>();
  const converted = new Set<string>();
  const sessions = new Map<string, Set<string>>();

  const byVariant = new Map<string, { visitors: Set<string>; conversions: Set<string> }>();
  const bySource = new Map<string, { kind: string; visitors: Set<string>; conversions: Set<string> }>();
  const byDevice = new Map<string, { visitors: Set<string>; conversions: Set<string> }>();
  const byDay = new Map<string, { visitors: Set<string>; conversions: number }>();

  const blockViewers = new Map<string, Set<string>>();
  const blockDwell = new Map<string, number>();
  const blockDwellCount = new Map<string, number>();
  const blockClicks = new Map<string, number>();
  const blockCta = new Map<string, number>();
  const scrollBuckets = new Map<number, Set<string>>();
  const timeOnPage = new Map<string, number>();

  /** Which source/device a visitor was first seen with, so a conversion is
   *  attributed to the campaign that brought them, not their last event. */
  const visitorSource = new Map<string, { label: string; kind: string }>();
  const visitorDevice = new Map<string, string>();
  const visitorVariant = new Map<string, string>();

  for (const e of events) {
    const meta = parseJson<Meta>(e.meta, {});
    const day = e.createdAt.toISOString().slice(0, 10);

    if (!sessions.has(e.visitorId)) sessions.set(e.visitorId, new Set());
    sessions.get(e.visitorId)!.add(e.sessionId);
    if (e.variantId && !visitorVariant.has(e.visitorId)) visitorVariant.set(e.visitorId, e.variantId);

    switch (e.type) {
      case "view": {
        landed.add(e.visitorId);
        if (!visitorSource.has(e.visitorId)) visitorSource.set(e.visitorId, sourceOf(meta));
        if (!visitorDevice.has(e.visitorId)) visitorDevice.set(e.visitorId, deviceOf(meta));
        if (!byDay.has(day)) byDay.set(day, { visitors: new Set(), conversions: 0 });
        byDay.get(day)!.visitors.add(e.visitorId);
        break;
      }
      case "scroll": {
        if ((e.value ?? 0) >= 25) scrolled.add(e.visitorId);
        const bucket = Math.min(100, Math.max(0, Math.round((e.value ?? 0) / 10) * 10));
        if (!scrollBuckets.has(bucket)) scrollBuckets.set(bucket, new Set());
        scrollBuckets.get(bucket)!.add(e.visitorId);
        break;
      }
      case "dwell": {
        timeOnPage.set(e.visitorId, (timeOnPage.get(e.visitorId) ?? 0) + (e.value ?? 0));
        if (e.blockId) {
          if (!blockViewers.has(e.blockId)) blockViewers.set(e.blockId, new Set());
          blockViewers.get(e.blockId)!.add(e.visitorId);
          blockDwell.set(e.blockId, (blockDwell.get(e.blockId) ?? 0) + (e.value ?? 0));
          blockDwellCount.set(e.blockId, (blockDwellCount.get(e.blockId) ?? 0) + 1);
          if (goalBlock && e.blockId === goalBlock.id) reachedGoal.add(e.visitorId);
        }
        break;
      }
      case "click":
        if (e.blockId) blockClicks.set(e.blockId, (blockClicks.get(e.blockId) ?? 0) + 1);
        break;
      case "cta":
        clickedCta.add(e.visitorId);
        if (e.blockId) blockCta.set(e.blockId, (blockCta.get(e.blockId) ?? 0) + 1);
        break;
      case "form_start":
        startedForm.add(e.visitorId);
        break;
      case "conversion": {
        converted.add(e.visitorId);
        if (!byDay.has(day)) byDay.set(day, { visitors: new Set(), conversions: 0 });
        byDay.get(day)!.conversions += 1;
        break;
      }
    }
  }

  /* ---- roll the per-visitor facts into the breakdowns ---- */
  for (const visitor of landed) {
    const src = visitorSource.get(visitor) ?? { label: "Direct / unknown", kind: "direct" };
    const dev = visitorDevice.get(visitor) ?? "Unknown";
    const vId = visitorVariant.get(visitor);
    const didConvert = converted.has(visitor);

    if (!bySource.has(src.label)) {
      bySource.set(src.label, { kind: src.kind, visitors: new Set(), conversions: new Set() });
    }
    bySource.get(src.label)!.visitors.add(visitor);
    if (didConvert) bySource.get(src.label)!.conversions.add(visitor);

    if (!byDevice.has(dev)) byDevice.set(dev, { visitors: new Set(), conversions: new Set() });
    byDevice.get(dev)!.visitors.add(visitor);
    if (didConvert) byDevice.get(dev)!.conversions.add(visitor);

    if (vId) {
      if (!byVariant.has(vId)) byVariant.set(vId, { visitors: new Set(), conversions: new Set() });
      byVariant.get(vId)!.visitors.add(visitor);
      if (didConvert) byVariant.get(vId)!.conversions.add(visitor);
    }
  }

  const top = Math.max(1, landed.size);

  const rawFunnel: { step: string; explain: string; set: Set<string> }[] = [
    { step: "Landed", explain: "Opened the page", set: landed },
    { step: "Read on", explain: "Scrolled past the first quarter", set: scrolled },
    ...(goalBlock
      ? [
          {
            step: goalBlock.type === "calendar" ? "Saw the booker" : "Saw the form",
            explain: "The conversion block entered their screen",
            set: reachedGoal,
          },
        ]
      : []),
    { step: "Clicked a CTA", explain: "Pressed a button or link", set: clickedCta },
    { step: "Started the form", explain: "Put the cursor in a field", set: startedForm },
    { step: "Converted", explain: "Submitted successfully", set: converted },
  ];

  const funnel: FunnelStep[] = rawFunnel.map((s, i) => ({
    step: s.step,
    explain: s.explain,
    visitors: s.set.size,
    ofTop: s.set.size / top,
    ofPrev: i === 0 ? 1 : s.set.size / Math.max(1, rawFunnel[i - 1].set.size),
  }));

  /* ---- daily series, gap-filled so the chart has no phantom gaps ---- */
  const daily: { date: string; visitors: number; conversions: number }[] = [];
  const spanDays =
    range.days || Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000));
  const start = range.key === "all" && events.length > 0 ? events[0].createdAt : range.from;
  const dayCount = Math.min(
    180,
    Math.max(1, Math.round((range.to.getTime() - start.getTime()) / 86400000) + 1),
    range.key === "all" ? 180 : spanDays + 1,
  );
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(range.to.getTime() - i * 86400000).toISOString().slice(0, 10);
    const row = byDay.get(d);
    daily.push({ date: d, visitors: row?.visitors.size ?? 0, conversions: row?.conversions ?? 0 });
  }

  /* ---- variants, scored on this window only ---- */
  const arms: Arm[] = page.variants.map((v) => ({
    id: v.id,
    impressions: byVariant.get(v.id)?.visitors.size ?? 0,
    conversions: byVariant.get(v.id)?.conversions.size ?? 0,
    active: v.active,
    isControl: v.isControl,
  }));
  const wins = winProbabilities(arms);

  const variants = page.variants.map((v) => {
    const visitors = byVariant.get(v.id)?.visitors.size ?? 0;
    const conversions = byVariant.get(v.id)?.conversions.size ?? 0;
    const p = wins[v.id] ?? 0;
    const match = parseJson<{ param?: string }>(v.match, {});
    return {
      id: v.id,
      name: v.name,
      angle: v.angle,
      isControl: v.isControl,
      active: v.active,
      targeted: Boolean(match.param),
      visitors,
      conversions,
      cvr: rate(conversions, visitors),
      winProbability: p,
      flag: (visitors < EXPLORE_MIN
        ? "starved"
        : p > 0.85
          ? "winning"
          : p < 0.05
            ? "losing"
            : "testing") as "starved" | "winning" | "losing" | "testing",
    };
  });

  /* ---- sections ---- */
  const audience = Math.max(1, landed.size);
  const rawDwell = blocks.map((b) => {
    const count = blockDwellCount.get(b.id) ?? 0;
    return count > 0 ? (blockDwell.get(b.id) ?? 0) / count / 1000 : 0;
  });
  const peak = Math.max(1, ...rawDwell);
  const sections = blocks.map((b, i) => ({
    blockId: b.id,
    type: b.type,
    label: b.headline || b.eyebrow || b.body?.slice(0, 60) || b.type,
    reach: (blockViewers.get(b.id)?.size ?? 0) / audience,
    dwellSeconds: Math.round(rawDwell[i] * 10) / 10,
    clicks: blockClicks.get(b.id) ?? 0,
    ctaClicks: blockCta.get(b.id) ?? 0,
    heat: rawDwell[i] / peak,
  }));

  const scroll = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((depth) => {
    let reached = new Set<string>();
    for (const [bucket, set] of scrollBuckets) {
      if (bucket >= depth) reached = new Set([...reached, ...set]);
    }
    return { depth, share: reached.size / audience };
  });

  /* ---- the same window immediately before, for a change figure ---- */
  let previous: Report["previous"] = null;
  if (range.key !== "all") {
    const length = range.to.getTime() - range.from.getTime();
    const prevFrom = new Date(range.from.getTime() - length);
    const prev = await prisma.event.findMany({
      where: {
        pageId,
        ...(variantId ? { variantId } : {}),
        createdAt: { gte: prevFrom, lt: range.from },
        type: { in: ["view", "conversion"] },
      },
      select: { type: true, visitorId: true },
      take: EVENT_CAP,
    });
    const pv = new Set<string>();
    let pc = 0;
    for (const e of prev) {
      if (e.type === "view") pv.add(e.visitorId);
      else pc += 1;
    }
    if (pv.size > 0) previous = { visitors: pv.size, conversions: pc, cvr: rate(pc, pv.size) };
  }

  const leadRows = await prisma.lead.findMany({
    where: { pageId, createdAt: { gte: range.from, lte: range.to } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { variant: { select: { name: true } } },
  });

  const times = [...timeOnPage.values()].sort((a, b) => a - b);
  const medianSeconds = times.length ? Math.round(times[Math.floor(times.length / 2)] / 100) / 10 : 0;

  const returning = [...sessions.values()].filter((s) => s.size > 1).length;

  return {
    range: {
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
      label: range.label,
      key: range.key,
    },
    totals: {
      visitors: landed.size,
      views: events.filter((e) => e.type === "view").length,
      returning,
      conversions: converted.size,
      cvr: rate(converted.size, landed.size),
      leads: leadRows.length,
      medianSeconds,
    },
    previous,
    funnel,
    daily,
    variants,
    sources: [...bySource.entries()]
      .map(([label, v]) => ({
        label,
        kind: v.kind,
        visitors: v.visitors.size,
        conversions: v.conversions.size,
        cvr: rate(v.conversions.size, v.visitors.size),
      }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 25),
    devices: [...byDevice.entries()]
      .map(([label, v]) => ({
        label,
        visitors: v.visitors.size,
        conversions: v.conversions.size,
        cvr: rate(v.conversions.size, v.visitors.size),
      }))
      .sort((a, b) => b.visitors - a.visitors),
    sections,
    scroll,
    leads: leadRows.map((l) => ({
      at: l.createdAt.toISOString().slice(0, 16).replace("T", " "),
      data: parseJson<Record<string, string>>(l.data, {}),
      forwarded: l.forwarded,
      suspect: l.suspect,
      variant: l.variant?.name ?? null,
    })),
  };
}
