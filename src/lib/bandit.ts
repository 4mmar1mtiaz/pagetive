/**
 * Variant selection.
 *
 * Fixed 50/50 splits never resolve at the traffic a normal landing page gets —
 * a page doing 40 conversions a month would spend most of a year reaching
 * significance on a two-way test, by which time the ad driving it has changed.
 * Thompson sampling spends traffic in proportion to how likely each variant is
 * to be the best one, so a clear winner starts taking share within days while
 * an unclear one keeps being tested.
 *
 * Two guardrails wrap the sampler:
 *   - New variants get a forced exploration quota. Beta(1,1) on zero data is a
 *     coin flip, and one unlucky early run can bury a variant that was fine.
 *   - No variant ever takes more than EXPLOIT_SHARE of traffic. Pages decay:
 *     an offer that won in March can be dead in June, and a bandit routed to
 *     100% has no way to notice.
 */

export type Arm = {
  id: string;
  impressions: number;
  conversions: number;
  active: boolean;
  isControl: boolean;
};

/** Impressions a variant is guaranteed before the sampler is allowed to judge it. */
export const EXPLORE_MIN = 100;

/** Ceiling on any single variant's share of traffic. */
export const EXPLOIT_SHARE = 0.8;

/** Marsaglia-Tsang gamma sampler — the standard way to get Beta without a stats lib. */
function gamma(shape: number): number {
  if (shape < 1) {
    // Boost low shapes into the valid range, then correct.
    return gamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      // Box-Muller for a standard normal.
      const u1 = Math.random() || 1e-12;
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(a: number, b: number): number {
  const x = gamma(a);
  const y = gamma(b);
  return x / (x + y);
}

/** Posterior mean conversion rate, Laplace-smoothed. Used for reporting. */
export function rate(arm: Pick<Arm, "impressions" | "conversions">): number {
  return (arm.conversions + 1) / (arm.impressions + 2);
}

/**
 * Probability this arm is the best of the set, by Monte Carlo over the
 * posteriors. This is the honest version of "chance to beat control" — far more
 * useful to a non-statistician than a p-value, and it does not require the test
 * to have ended.
 */
export function winProbabilities(arms: Arm[], draws = 4000): Record<string, number> {
  const live = arms.filter((a) => a.active);
  const wins: Record<string, number> = {};
  for (const a of live) wins[a.id] = 0;
  if (live.length === 0) return wins;
  if (live.length === 1) return { [live[0].id]: 1 };

  for (let i = 0; i < draws; i++) {
    let bestId = live[0].id;
    let best = -1;
    for (const a of live) {
      const sample = beta(a.conversions + 1, Math.max(0, a.impressions - a.conversions) + 1);
      if (sample > best) {
        best = sample;
        bestId = a.id;
      }
    }
    wins[bestId] += 1;
  }
  for (const id of Object.keys(wins)) wins[id] = wins[id] / draws;
  return wins;
}

/** Pick the variant to serve for one impression. */
export function choose(arms: Arm[]): Arm | null {
  const live = arms.filter((a) => a.active);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];

  // Anything still under its exploration quota is served first, so a new
  // variant reaches judgeable volume instead of starving behind an incumbent.
  const starved = live.filter((a) => a.impressions < EXPLORE_MIN);
  if (starved.length > 0) return starved[Math.floor(Math.random() * starved.length)];

  let winner = live[0];
  let best = -1;
  for (const a of live) {
    const sample = beta(a.conversions + 1, Math.max(0, a.impressions - a.conversions) + 1);
    if (sample > best) {
      best = sample;
      winner = a;
    }
  }

  // Hold back a slice for everyone else so decay stays detectable.
  if (Math.random() > EXPLOIT_SHARE) {
    const others = live.filter((a) => a.id !== winner.id);
    if (others.length > 0) return others[Math.floor(Math.random() * others.length)];
  }
  return winner;
}
