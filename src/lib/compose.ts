import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { applyOverrides, normalizeBlocks, type Block, type MatchRule, type Overrides } from "@/lib/blocks";
import { choose, type Arm } from "@/lib/bandit";

/**
 * Deciding which version of a page a given request sees.
 *
 * This resolves in two layers, and keeping them separate is the whole point.
 *
 *   INTENT decides WHICH ANGLE is allowed.  Statistics decide WHICH VERSION
 *   of that angle gets served.
 *
 * Getting this wrong is the classic failure of every "AI optimises your page"
 * tool: somebody clicks an ad promising same-day service, the optimiser
 * notices that the money-back variant converts better on average, and serves
 * them a page about refunds. The click is wasted, and the numbers look fine
 * because the mismatch is invisible in the aggregate.
 *
 * So a variant carrying a match rule is eligible ONLY when its rule fires, and
 * a variant carrying no rule is eligible only when no rule fired. A promise
 * written for one audience is never shown to a different one, in either
 * direction. Inside whichever pool that leaves, the bandit is free — which is
 * how you can run three versions of the same angle and still learn which one
 * of them works.
 *
 * Full order:
 *   1. An explicit ?v= wins — preview and QA must be deterministic.
 *   2. Match rules select the eligible pool.
 *   3. A returning visitor keeps what they were given (handled by the caller).
 *   4. The bandit picks within the pool.
 *
 * All of it resolves server-side before first paint. Client-side content
 * swapping would show the wrong headline for a beat on every load, and that
 * flash is worse than not personalising at all.
 */

export type ResolvedVariant = {
  id: string;
  name: string;
  angle: string;
  overrides: Overrides;
  isControl: boolean;
};

export type VariantRow = {
  id: string;
  name: string;
  angle: string;
  match: string;
  overrides: string;
  isControl: boolean;
  active: boolean;
  impressions: number;
  conversions: number;
};

function matches(rule: MatchRule, params: URLSearchParams): boolean {
  if (!rule?.param || !rule?.contains) return false;
  const value = params.get(rule.param);
  if (!value) return false;
  return value.toLowerCase().includes(rule.contains.toLowerCase());
}

export function pickVariant(
  variants: VariantRow[],
  params: URLSearchParams,
  forcedId?: string | null,
): VariantRow | null {
  if (variants.length === 0) return null;

  if (forcedId) {
    const forced = variants.find((v) => v.id === forcedId);
    if (forced) return forced;
  }

  const active = variants.filter((v) => v.active);
  if (active.length === 0) return null;

  const rules = new Map(active.map((v) => [v.id, parseJson<MatchRule>(v.match, {})]));
  const targeted = (v: VariantRow) => {
    const r = rules.get(v.id);
    return Boolean(r?.param && r?.contains);
  };

  // Anything whose rule fires for this URL. If two rules match, both stay in
  // the pool and the bandit decides between them — which is the right answer
  // when an ad is both "same-day" and "no call-out fee".
  const matchedPool = active.filter((v) => targeted(v) && matches(rules.get(v.id)!, params));

  // Otherwise, only the untargeted variants. A variant written for a specific
  // ad is withheld from everyone else rather than leaking into general traffic.
  const generalPool = active.filter((v) => !targeted(v));

  const pool = matchedPool.length > 0 ? matchedPool : generalPool;

  // Every variant is targeted and none matched: serve the control rather than
  // an arbitrary promise. If there is no control, the page still has to render,
  // so fall back to the full set.
  const candidates =
    pool.length > 0 ? pool : active.filter((v) => v.isControl).concat(active).slice(0, active.length);

  const arms: Arm[] = candidates.map((v) => ({
    id: v.id,
    impressions: v.impressions,
    conversions: v.conversions,
    active: v.active,
    isControl: v.isControl,
  }));
  const picked = choose(arms);
  return (
    candidates.find((v) => v.id === picked?.id) ??
    candidates.find((v) => v.isControl) ??
    candidates[0]
  );
}

/** Which variants a given URL is allowed to see. Exposed so the analytics can
 *  explain a routing decision instead of it being a black box. */
export function eligibleFor(variants: VariantRow[], params: URLSearchParams): VariantRow[] {
  const active = variants.filter((v) => v.active);
  const rules = new Map(active.map((v) => [v.id, parseJson<MatchRule>(v.match, {})]));
  const targeted = (v: VariantRow) => {
    const r = rules.get(v.id);
    return Boolean(r?.param && r?.contains);
  };
  const matched = active.filter((v) => targeted(v) && matches(rules.get(v.id)!, params));
  return matched.length > 0 ? matched : active.filter((v) => !targeted(v));
}

/** Resolve, honouring the sticky assignment for a known visitor. */
export async function resolveForVisitor(args: {
  pageId: string;
  variants: VariantRow[];
  params: URLSearchParams;
  visitorId: string;
  forcedId?: string | null;
}): Promise<VariantRow | null> {
  const { pageId, variants, params, visitorId, forcedId } = args;
  if (forcedId) return pickVariant(variants, params, forcedId);

  const existing = await prisma.assignment.findUnique({
    where: { pageId_visitorId: { pageId, visitorId } },
  });
  if (existing) {
    const stuck = variants.find((v) => v.id === existing.variantId && v.active);
    // Two reasons a visitor is released from their assignment:
    //   - the variant was retired, and serving dead copy helps nobody;
    //   - they have arrived on a link whose targeting excludes it. Someone who
    //     browsed generally last week and today clicked a same-day ad should
    //     see the same-day promise. Intent from this click beats stickiness
    //     from the last one, or message match quietly stops working for
    //     everyone who has ever visited before.
    if (stuck && eligibleFor(variants, params).some((v) => v.id === stuck.id)) return stuck;
  }

  const picked = pickVariant(variants, params, null);
  if (!picked) return null;

  // Only a general-traffic serve is remembered.
  //
  // A targeted serve does not need to be: the rule is deterministic, so the
  // same link always resolves the same way without storing anything. Writing
  // it down would be actively harmful — one ad click would overwrite the
  // visitor's general assignment, and when they came back to the plain URL
  // they would be re-rolled onto a third version. Stickiness has to survive a
  // detour through a campaign link.
  const isTargetedServe = eligibleFor(variants, params).some(
    (v) => v.id === picked.id && parseJson<MatchRule>(v.match, {}).param,
  );
  if (!isTargetedServe) {
    await prisma.assignment.upsert({
      where: { pageId_visitorId: { pageId, visitorId } },
      create: { pageId, visitorId, variantId: picked.id },
      update: { variantId: picked.id },
    });
  }
  return picked;
}

/** Master blocks + the chosen variant's overrides = what the visitor reads. */
export function composeBlocks(masterBlocksRaw: string, variant: VariantRow | null): Block[] {
  const master = normalizeBlocks(parseJson<Block[]>(masterBlocksRaw, []));
  if (!variant) return master;
  return applyOverrides(master, parseJson<Overrides>(variant.overrides, {}));
}
