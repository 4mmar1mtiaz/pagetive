import { parseJson } from "@/lib/json";

/**
 * The next-step cards the workspace can show, one at a time, for the selected
 * page. A key is stored on the account when its card is closed, and that card
 * is not shown again on any page: closing "test variations" on one page is an
 * answer about the feature, not about that page.
 */
export const NUDGE_KEYS = ["variants", "publish", "domain", "integrations", "agent-api"] as const;

export type NudgeKey = (typeof NUDGE_KEYS)[number];

export function isNudgeKey(v: unknown): v is NudgeKey {
  return typeof v === "string" && (NUDGE_KEYS as readonly string[]).includes(v);
}

/** The stored column, read defensively: anything that is not a known key is dropped. */
export function dismissedFrom(raw: string | null | undefined): NudgeKey[] {
  const list = parseJson<unknown>(raw, []);
  return Array.isArray(list) ? list.filter(isNudgeKey) : [];
}
