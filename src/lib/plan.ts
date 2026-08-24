/**
 * What each plan is allowed to do.
 *
 * Right now everything is free and unlimited, and DEFAULT_PLAN below is what
 * makes that true. This is not a stripped-down build: the metered plan is fully
 * implemented and enforced, it is simply not the default. Serving pages costs
 * nothing per visitor, so there is nothing to recover from users yet.
 *
 * To turn it into a business later, change DEFAULT_PLAN to "trial" and set
 * prices on the marketing page. Nothing else has to move — the limits, the
 * upgrade webhook and the admin overrides are all already wired.
 *
 * Entitlement is checked on the server, in the tool layer and again in the HTTP
 * layer. Hiding a button is a UI courtesy, not a limit.
 */

export type Plan = "trial" | "unlimited";

export type Entitlements = {
  label: string;
  /** Lifetime page count. Deleting a page does not buy another one. */
  maxPages: number | null;
  canPublish: boolean;
  canExport: boolean;
  canAttachDomain: boolean;
  canSimulate: boolean;
};

/**
 * What a new account gets.
 *
 * "unlimited" means free forever with no page cap. "trial" switches on the
 * one-page metered tier.
 */
export const DEFAULT_PLAN: Plan = "unlimited";

const PLANS: Record<Plan, Entitlements> = {
  trial: {
    label: "Free trial",
    maxPages: 1,
    canPublish: false,
    canExport: false,
    canAttachDomain: false,
    // Simulation stays open on purpose. It is the fastest way to understand
    // what the product actually does, and it costs nothing to serve.
    canSimulate: true,
  },
  unlimited: {
    label: "Free — unlimited",
    maxPages: null,
    canPublish: true,
    canExport: true,
    canAttachDomain: true,
    canSimulate: true,
  },
};

/**
 * What an account may do.
 *
 * `override` is a per-account page limit set from the admin screen. It exists
 * so one customer can be given more room without inventing a plan for them —
 * the alternative is a proliferation of near-identical plans, which is how
 * pricing pages become unmaintainable. A suspended account keeps everything it
 * has and can do nothing new; nothing is deleted, so suspension is reversible.
 */
export function entitlements(
  plan: string | null | undefined,
  opts?: { override?: number | null; suspended?: boolean },
): Entitlements {
  const base = PLANS[(plan as Plan) ?? "trial"] ?? PLANS.trial;
  const withOverride =
    opts?.override === undefined || opts?.override === null
      ? base
      : { ...base, maxPages: opts.override };

  if (!opts?.suspended) return withOverride;
  return {
    ...withOverride,
    label: `${withOverride.label} (suspended)`,
    maxPages: 0,
    canPublish: false,
    canExport: false,
    canAttachDomain: false,
    canSimulate: false,
  };
}

/** The message a blocked action returns. Written to be shown verbatim — to the
 *  user in the UI, and to the model, which will relay it in its own words. */
export function upgradeMessage(action: "publish" | "export" | "domain" | "page"): string {
  switch (action) {
    case "publish":
      return "Publishing is not included in the free trial. The page is built and you can preview it — going live needs the unlimited plan.";
    case "export":
      return "Exporting is not included in the free trial. You can see the finished page in preview; downloading the HTML needs the unlimited plan.";
    case "domain":
      return "Custom domains are not included in the free trial. Upgrade to unlimited to serve pages on your own hostnames.";
    case "page":
      return "The free trial covers one landing page. You have used it — build on that page as much as you like, or upgrade to unlimited for more.";
  }
}
