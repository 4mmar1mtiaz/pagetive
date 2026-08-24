import { prisma } from "@/lib/db";
import { parseJson, toJson } from "@/lib/json";
import { normalizeBlocks, type Block } from "@/lib/blocks";
import { choose, type Arm } from "@/lib/bandit";

/**
 * Synthetic traffic.
 *
 * Everything downstream of a published page — the bandit, the heatmap, the
 * section report, the optimizer — needs thousands of visitors before it says
 * anything. Waiting for real ones to find out whether the maths works is a
 * terrible feedback loop, so this manufactures a realistic population.
 *
 * "Realistic" is doing real work here. Uniform random events produce a flat
 * heatmap and a bandit that never resolves, which would prove nothing. So:
 *
 *   - Each variant is given a hidden true conversion rate, derived from a hash
 *     of its id so the same page always simulates the same way. One variant is
 *     genuinely better. The optimizer has to actually find it.
 *   - Variants are chosen through the real bandit, not round-robin, so the
 *     traffic distribution you end up looking at is the one the live sampler
 *     would have produced.
 *   - Attention decays down the page, with a bump on whichever block holds the
 *     conversion path. That is what real scroll data looks like, and it is what
 *     makes the attention overlay legible instead of uniformly warm.
 *
 * Block positions are approximated by index, because the server does not know
 * the rendered pixel height of anything. Real traffic reports true coordinates;
 * these are evenly spaced. Good enough to exercise the view, and worth knowing
 * before reading too much into a simulated heatmap.
 *
 * Traffic also arrives from a mix of campaigns and devices, with mobile
 * converting worse than desktop — which is true of nearly every real form and
 * is the single most common thing a first look at this report should surface.
 */

export type SimulationResult = {
  visitors: number;
  conversions: number;
  events: number;
  perVariant: { name: string; visitors: number; conversions: number; trueRate: string }[];
  days: number;
};

/** Deterministic 0-1 from a string. Same page, same simulation, every time. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Most people leave early; a few read everything. */
function scrollDepth(): number {
  const r = Math.random();
  if (r < 0.28) return 10 + Math.floor(Math.random() * 20);
  if (r < 0.62) return 30 + Math.floor(Math.random() * 30);
  if (r < 0.88) return 60 + Math.floor(Math.random() * 25);
  return 85 + Math.floor(Math.random() * 15);
}

export async function simulateTraffic(pageId: string, visitors: number, days = 14): Promise<SimulationResult> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { variants: { where: { active: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!page) throw new Error("Page not found");
  if (page.variants.length === 0) throw new Error("This page has no variants to test.");

  const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));
  if (blocks.length === 0) throw new Error("This page has no blocks.");

  const conversionBlock = blocks.findIndex((b) => b.type === "form" || b.type === "calendar");
  const goalIndex = conversionBlock === -1 ? blocks.length - 1 : conversionBlock;

  // Hidden truth. 1.2% to 7.4%, control pinned mid-range so a generated variant
  // can plausibly beat it or lose to it.
  const truth = new Map<string, number>();
  for (const v of page.variants) {
    truth.set(v.id, v.isControl ? 0.028 : 0.012 + hash01(v.id) * 0.062);
  }

  const counts = new Map<string, { visitors: number; conversions: number }>();
  for (const v of page.variants) counts.set(v.id, { visitors: 0, conversions: 0 });

  const arms: Arm[] = page.variants.map((v) => ({
    id: v.id,
    impressions: v.impressions,
    conversions: v.conversions,
    active: v.active,
    isControl: v.isControl,
  }));

  type Row = {
    pageId: string;
    variantId: string;
    visitorId: string;
    sessionId: string;
    type: string;
    blockId: string | null;
    x: number | null;
    y: number | null;
    value: number | null;
    meta: string;
    createdAt: Date;
  };
  const rows: Row[] = [];
  const leads: { pageId: string; variantId: string; data: string; forwarded: boolean; createdAt: Date }[] = [];

  const now = Date.now();
  const span = days * 24 * 3600 * 1000;
  const firstNames = ["Alex", "Jordan", "Sam", "Priya", "Marcus", "Dana", "Chris", "Nina", "Omar", "Tess"];
  const lastNames = ["Reed", "Vance", "Ortiz", "Shah", "Boyd", "Kim", "Nolan", "Ellis", "Cruz", "Hart"];

  // Weighted traffic mix. Shares are cumulative thresholds against one draw.
  const SOURCES: { q: string; ref: string; upto: number }[] = [
    { q: "?utm_source=meta&utm_campaign=always-on&utm_content=same-day-v3", ref: "https://l.facebook.com/", upto: 0.3 },
    { q: "?utm_source=meta&utm_campaign=always-on&utm_content=comes-to-you-v1", ref: "https://l.facebook.com/", upto: 0.48 },
    { q: "?utm_source=google&utm_campaign=search-brand&utm_content=exact", ref: "https://www.google.com/", upto: 0.64 },
    { q: "?utm_source=email&utm_campaign=weekly&seg=warm", ref: "", upto: 0.76 },
    { q: "", ref: "https://www.google.com/", upto: 0.9 },
    { q: "", ref: "", upto: 1 },
  ];
  const DEVICES: { w: number; upto: number; lift: number }[] = [
    { w: 390, upto: 0.62, lift: 0.72 }, // phones: most of the traffic, worst at forms
    { w: 820, upto: 0.72, lift: 0.95 },
    { w: 1440, upto: 1, lift: 1.35 },
  ];
  const draw = <T extends { upto: number }>(rows: T[]): T => {
    const r = Math.random();
    return rows.find((x) => r <= x.upto) ?? rows[rows.length - 1];
  };

  let conversions = 0;

  for (let i = 0; i < visitors; i++) {
    const armState = arms.find((a) => a.id) ?? arms[0];
    void armState;
    const picked = choose(arms);
    if (!picked) break;

    const variantId = picked.id;
    const visitorId = `sim-${hash01(`${pageId}${i}`).toString(36).slice(2)}${i}`;
    const sessionId = `sims-${i}`;
    // Weighted toward recent so the page looks like it is picking up, not dying.
    const at = new Date(now - Math.floor(Math.pow(Math.random(), 1.6) * span));

    const stat = counts.get(variantId)!;
    stat.visitors += 1;
    const arm = arms.find((a) => a.id === variantId)!;
    arm.impressions += 1;

    const base = { pageId, variantId, visitorId, sessionId, createdAt: at };
    const src = draw(SOURCES);
    const dev = draw(DEVICES);
    rows.push({
      ...base,
      type: "view",
      blockId: null,
      x: null,
      y: null,
      value: null,
      meta: toJson({ ref: src.ref, q: src.q, w: dev.w }),
    });

    const depth = scrollDepth();
    for (let d = 10; d <= depth; d += 10) {
      rows.push({ ...base, type: "scroll", blockId: null, x: null, y: null, value: d, meta: "{}" });
    }

    // Attention per block, only as far as they actually scrolled.
    const reachedTo = Math.max(0, Math.min(blocks.length - 1, Math.floor((depth / 100) * blocks.length)));
    for (let b = 0; b <= reachedTo; b++) {
      const decay = Math.exp(-b * 0.35);
      const goalBump = b === goalIndex ? 1.9 : 1;
      const ms = Math.round((900 + Math.random() * 5200) * decay * goalBump);
      if (ms < 320) continue;
      rows.push({
        ...base,
        type: "dwell",
        blockId: blocks[b].id,
        x: null,
        y: null,
        value: ms,
        meta: "{}",
      });
    }

    const converts = Math.random() < (truth.get(variantId) ?? 0.02) * dev.lift;

    // A quarter of visitors click something; converters always hit a CTA first.
    if (converts || Math.random() < 0.26) {
      const b = converts ? Math.min(goalIndex, reachedTo) : Math.floor(Math.random() * (reachedTo + 1));
      const band = 1 / blocks.length;
      rows.push({
        ...base,
        type: converts || Math.random() < 0.5 ? "cta" : "click",
        blockId: blocks[b].id,
        // Clicks cluster on the button, roughly centred, with real spread.
        x: Math.min(0.98, Math.max(0.02, 0.5 + (Math.random() - 0.5) * 0.34)),
        y: Math.min(0.99, b * band + band * (0.35 + Math.random() * 0.4)),
        value: null,
        meta: toJson({ label: blocks[b].ctaText ?? blocks[b].headline ?? blocks[b].type }),
      });
    }

    // Form abandonment. Everyone who converts obviously started, and roughly
    // twice as many again start and give up — which is what the real gap
    // between starts and submits looks like on a page with a decent form. If
    // the simulator skipped this the funnel's most useful step would read zero
    // and the page would look broken rather than realistic.
    if (reachedTo >= goalIndex && (converts || Math.random() < 0.09)) {
      rows.push({
        ...base,
        type: "form_start",
        blockId: blocks[goalIndex].id,
        x: null,
        y: null,
        value: null,
        meta: "{}",
      });
    }

    if (converts) {
      conversions += 1;
      stat.conversions += 1;
      arm.conversions += 1;
      const first = pick(firstNames);
      const last = pick(lastNames);
      rows.push({
        ...base,
        type: "conversion",
        blockId: blocks[goalIndex].id,
        x: null,
        y: null,
        value: null,
        meta: toJson({ simulated: true }),
      });
      leads.push({
        pageId,
        variantId,
        data: toJson({
          name: `${first} ${last}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
          phone: `214-555-${String(1000 + Math.floor(Math.random() * 8999))}`,
          _simulated: "true",
        }),
        forwarded: false,
        createdAt: at,
      });
    }
  }

  // Batched because a thousand visitors is tens of thousands of rows and SQLite
  // does not enjoy that one statement at a time.
  for (let i = 0; i < rows.length; i += 2000) {
    await prisma.event.createMany({ data: rows.slice(i, i + 2000) });
  }
  if (leads.length) await prisma.lead.createMany({ data: leads });

  for (const [variantId, stat] of counts) {
    if (stat.visitors === 0) continue;
    await prisma.variant.update({
      where: { id: variantId },
      data: {
        impressions: { increment: stat.visitors },
        conversions: { increment: stat.conversions },
      },
    });
  }

  return {
    visitors,
    conversions,
    events: rows.length,
    days,
    perVariant: page.variants.map((v) => ({
      name: v.name,
      visitors: counts.get(v.id)?.visitors ?? 0,
      conversions: counts.get(v.id)?.conversions ?? 0,
      trueRate: `${((truth.get(v.id) ?? 0) * 100).toFixed(1)}%`,
    })),
  };
}

/** Undo. Simulated rows are tagged, so real traffic is never touched. */
export async function clearSimulation(pageId: string): Promise<number> {
  const removed = await prisma.event.deleteMany({ where: { pageId, visitorId: { startsWith: "sim-" } } });
  await prisma.lead.deleteMany({ where: { pageId, data: { contains: '"_simulated"' } } });

  // Impression and conversion counters live on the variant row, so they have to
  // be rebuilt from what survives rather than decremented by a guess.
  const variants = await prisma.variant.findMany({ where: { pageId } });
  for (const v of variants) {
    const impressions = await prisma.event.count({ where: { variantId: v.id, type: "view" } });
    const conversions = await prisma.event.count({ where: { variantId: v.id, type: "conversion" } });
    await prisma.variant.update({ where: { id: v.id }, data: { impressions, conversions } });
  }
  return removed.count;
}
