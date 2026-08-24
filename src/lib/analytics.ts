import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { normalizeBlocks, type Block } from "@/lib/blocks";
import { EXPLORE_MIN, rate, winProbabilities, type Arm } from "@/lib/bandit";

/**
 * Everything the analytics screen shows, computed from the raw event table.
 *
 * The reporting unit is the block, not the pixel. Because this app renders the
 * page itself, every click already knows which block it landed in — so instead
 * of a coordinate blob that a human has to interpret, the same data answers
 * "did anyone read the pricing section" directly. The coordinate map is still
 * produced, because a heatmap is what people expect to see and it does catch
 * the thing block stats miss: clicks on elements that are not links.
 */

export type SectionStat = {
  blockId: string;
  type: string;
  label: string;
  /** Share of visitors whose viewport ever contained this block. */
  reach: number;
  /** Median-ish attention: mean dwell in seconds among visitors who saw it. */
  dwellSeconds: number;
  clicks: number;
  ctaClicks: number;
  /** 0-1, dwell normalised across the page. Drives the section heat colour. */
  heat: number;
};

export type VariantStat = {
  id: string;
  name: string;
  angle: string;
  isControl: boolean;
  active: boolean;
  impressions: number;
  conversions: number;
  cvr: number;
  winProbability: number;
  flag: "starved" | "winning" | "losing" | "testing";
};

export type PageAnalytics = {
  totals: {
    views: number;
    visitors: number;
    conversions: number;
    leads: number;
    cvr: number;
  };
  variants: VariantStat[];
  sections: SectionStat[];
  scroll: { depth: number; share: number }[];
  heat: { x: number; y: number; weight: number }[];
  recent: { at: string; type: string; detail: string }[];
};

const HEAT_CAP = 4000;

export async function pageAnalytics(pageId: string, variantId?: string | null): Promise<PageAnalytics> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
  if (!page) throw new Error("Page not found");

  const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));

  const where = variantId ? { pageId, variantId } : { pageId };
  const events = await prisma.event.findMany({
    where,
    select: {
      type: true,
      blockId: true,
      visitorId: true,
      x: true,
      y: true,
      value: true,
      meta: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    // A page doing real traffic will outgrow an in-memory rollup; at that point
    // this becomes a nightly aggregate table. Until then, honest numbers beat a
    // premature pipeline, and the cap keeps a runaway page from hanging the UI.
    take: 200000,
  });

  const visitors = new Set<string>();
  const viewers = new Set<string>();
  let views = 0;
  let conversions = 0;

  const blockViewers = new Map<string, Set<string>>();
  const blockDwell = new Map<string, number>();
  const blockDwellCount = new Map<string, number>();
  const blockClicks = new Map<string, number>();
  const blockCta = new Map<string, number>();
  const scrollBuckets = new Map<number, Set<string>>();
  const heat: { x: number; y: number; weight: number }[] = [];

  for (const e of events) {
    visitors.add(e.visitorId);
    switch (e.type) {
      case "view":
        views += 1;
        viewers.add(e.visitorId);
        break;
      case "conversion":
        conversions += 1;
        break;
      case "click":
        if (e.blockId) blockClicks.set(e.blockId, (blockClicks.get(e.blockId) ?? 0) + 1);
        if (typeof e.x === "number" && typeof e.y === "number" && heat.length < HEAT_CAP) {
          heat.push({ x: e.x, y: e.y, weight: 1 });
        }
        break;
      case "cta":
        if (e.blockId) blockCta.set(e.blockId, (blockCta.get(e.blockId) ?? 0) + 1);
        if (typeof e.x === "number" && typeof e.y === "number" && heat.length < HEAT_CAP) {
          heat.push({ x: e.x, y: e.y, weight: 2 });
        }
        break;
      case "dwell":
        if (e.blockId) {
          if (!blockViewers.has(e.blockId)) blockViewers.set(e.blockId, new Set());
          blockViewers.get(e.blockId)!.add(e.visitorId);
          blockDwell.set(e.blockId, (blockDwell.get(e.blockId) ?? 0) + (e.value ?? 0));
          blockDwellCount.set(e.blockId, (blockDwellCount.get(e.blockId) ?? 0) + 1);
        }
        break;
      case "scroll": {
        const bucket = Math.min(100, Math.max(0, Math.round((e.value ?? 0) / 10) * 10));
        if (!scrollBuckets.has(bucket)) scrollBuckets.set(bucket, new Set());
        scrollBuckets.get(bucket)!.add(e.visitorId);
        break;
      }
    }
  }

  const audience = Math.max(1, viewers.size);

  const rawDwell = blocks.map((b) => {
    const count = blockDwellCount.get(b.id) ?? 0;
    return count > 0 ? (blockDwell.get(b.id) ?? 0) / count / 1000 : 0;
  });
  const peakDwell = Math.max(1, ...rawDwell);

  const sections: SectionStat[] = blocks.map((b, i) => ({
    blockId: b.id,
    type: b.type,
    label: b.headline || b.eyebrow || b.body?.slice(0, 60) || b.type,
    reach: (blockViewers.get(b.id)?.size ?? 0) / audience,
    dwellSeconds: Math.round(rawDwell[i] * 10) / 10,
    clicks: blockClicks.get(b.id) ?? 0,
    ctaClicks: blockCta.get(b.id) ?? 0,
    heat: rawDwell[i] / peakDwell,
  }));

  const scroll = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((depth) => {
    // Reaching 80% means you also reached 50%, so each bucket counts everyone
    // at or past it — otherwise the curve reads as a series of cliffs.
    let reached = new Set<string>();
    for (const [bucket, set] of scrollBuckets) {
      if (bucket >= depth) reached = new Set([...reached, ...set]);
    }
    return { depth, share: reached.size / audience };
  });

  const arms: Arm[] = page.variants.map((v) => ({
    id: v.id,
    impressions: v.impressions,
    conversions: v.conversions,
    active: v.active,
    isControl: v.isControl,
  }));
  const wins = winProbabilities(arms);

  const variants: VariantStat[] = page.variants.map((v) => {
    const p = wins[v.id] ?? 0;
    const flag: VariantStat["flag"] =
      v.impressions < EXPLORE_MIN ? "starved" : p > 0.85 ? "winning" : p < 0.05 ? "losing" : "testing";
    return {
      id: v.id,
      name: v.name,
      angle: v.angle,
      isControl: v.isControl,
      active: v.active,
      impressions: v.impressions,
      conversions: v.conversions,
      cvr: v.impressions > 0 ? v.conversions / v.impressions : rate(v),
      winProbability: p,
      flag,
    };
  });

  const leads = await prisma.lead.count({ where: { pageId } });

  const recent = events.slice(0, 25).map((e) => ({
    at: e.createdAt.toISOString().slice(0, 16).replace("T", " "),
    type: e.type,
    detail: e.blockId ?? parseJson<{ label?: string }>(e.meta, {}).label ?? "",
  }));

  return {
    totals: {
      views,
      visitors: visitors.size,
      conversions,
      leads,
      cvr: views > 0 ? conversions / views : 0,
    },
    variants,
    sections,
    scroll,
    heat,
    recent,
  };
}
