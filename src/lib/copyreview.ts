import { structured } from "@/lib/llm";
import { BLOCK_REFERENCE, normalizeBlocks, type Block } from "@/lib/blocks";

/**
 * A second pass over generated copy.
 *
 * Instructions in a prompt are necessary and not sufficient. A model writing a
 * whole page in one shot is optimising for coherence across nine blocks, and
 * the individual sentence that slid into "streamline your workflow" is not
 * something it notices while doing that. Reading its own output back with one
 * job to do catches what generation misses, which is why the revision here is a
 * separate call rather than a longer prompt.
 *
 * Two things make this worth its cost. It is mechanical where it can be: the
 * banned characters and the grid arithmetic are checked in code first and handed
 * over as findings, so the model is not asked to count. And it is allowed to
 * change nothing, so a page that was already good does not get rewritten into a
 * different page for the sake of activity.
 */

const BANNED_PHRASES = [
  "unlock", "elevate", "seamless", "cutting-edge", "cutting edge", "revolutionary",
  "game-changing", "game changing", "world-class", "world class", "best-in-class",
  "best in class", "empower", "leverage", "robust", "next level", "take it to the",
  "we are passionate", "transform your business", "streamline your", "journey",
  "solutions for", "one-stop", "state-of-the-art", "unparalleled", "synergy",
];

/** Faults a machine can find exactly, so the model never has to count or scan. */
export function lintBlocks(blocks: Block[]): string[] {
  const findings: string[] = [];
  const text = (b: Block): string =>
    JSON.stringify({ ...b, id: undefined, type: undefined });

  for (const b of blocks) {
    const raw = text(b);

    if (/[—–]/.test(raw)) findings.push(`${b.id}: contains an em or en dash. Rewrite as two sentences or use a comma.`);
    if (/[‘’“”]/.test(raw)) findings.push(`${b.id}: contains smart quotes. Use straight quotes.`);
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(raw)) findings.push(`${b.id}: contains an emoji. Remove it.`);
    if ((b.items ?? []).some((item) => item.icon)) {
      findings.push(`${b.id}: sets the deprecated icon field on an item. Remove it.`);
    }

    const lower = raw.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      if (lower.includes(phrase)) findings.push(`${b.id}: uses the banned phrase "${phrase}". Say the specific thing instead.`);
    }

    const n = b.items?.length ?? 0;
    if (["features", "steps", "proof"].includes(b.type) && n > 0 && n !== 3 && n !== 6) {
      findings.push(`${b.id}: has ${n} items. A ${b.type} grid must have exactly 3 or 6 so no row is left with an orphan. Cut to 3 or expand to 6.`);
    }
    if (b.type === "stats" && n > 0 && ![2, 4, 8].includes(n)) {
      findings.push(`${b.id}: has ${n} stats. Use exactly 2, 4, or 8.`);
    }

    for (const item of b.items ?? []) {
      const words = (item.body ?? item.a ?? "").split(/\s+/).filter(Boolean).length;
      if (words > 55) findings.push(`${b.id}: an item runs to ${words} words. Landing page copy is two or three sentences.`);
    }
  }

  const hasPath = blocks.some((b) => b.type === "form" || b.type === "calendar");
  if (!hasPath) findings.push("The page has no form and no calendar, so there is no way to convert.");

  return findings;
}

export type ReviewResult = { blocks: Block[]; changed: boolean; notes: string };

export async function reviewCopy(args: {
  blocks: Block[];
  context: string;
  apiKey?: string;
  accountId?: string | null;
  pageId?: string | null;
}): Promise<ReviewResult> {
  const findings = lintBlocks(args.blocks);

  const result = await structured<{ blocksJson: string; notes: string; changed: boolean }>({
    system: `You are an editor, not a writer. You are given a finished landing page and you improve it in place.

${BLOCK_REFERENCE}

Your job, in priority order:
1. Fix every mechanical fault listed for you. Those were found by a checker and are not opinions.
2. Cut anything a competitor could say word for word. Generic sentences are worse than no sentence.
3. Make each headline promise something specific. Replace abstraction with the concrete thing.
4. Vary sentence rhythm. Identical cadence across three sentences reads as machine output.
5. Keep every factual claim exactly as it is. You may not add a number, a name, a
   guarantee or a testimonial that is not already there. If a claim looks invented,
   delete it rather than softening it.

Constraints: keep the same block ids and the same block types. Do not add or
remove blocks except to fix a grid count. Do not lengthen the page. If the copy
is already strong, return it unchanged and say so, with changed set to false.`,
    prompt: `Context for this page:
${args.context}

${findings.length ? `Mechanical faults found by the checker (fix all of these):\n${findings.map((f) => `- ${f}`).join("\n")}` : "The checker found no mechanical faults."}

The page:
${JSON.stringify(args.blocks, null, 2)}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["blocksJson", "notes", "changed"],
      properties: {
        blocksJson: { type: "string", description: "The full revised block array, serialised as JSON." },
        notes: { type: "string", description: "One short paragraph on what you changed and why." },
        changed: { type: "boolean" },
      },
    },
    maxTokens: 32000,
    kind: "variants",
    accountId: args.accountId,
    pageId: args.pageId,
    apiKey: args.apiKey,
  });

  const revised = normalizeBlocks(JSON.parse(result.blocksJson || "[]"));
  // A revision that came back empty or mangled is worse than no revision.
  if (revised.length === 0) return { blocks: args.blocks, changed: false, notes: "Revision discarded: empty result." };

  const remaining = lintBlocks(revised);
  return {
    blocks: revised,
    changed: result.changed,
    notes: remaining.length
      ? `${result.notes} Still unresolved: ${remaining.join(" ")}`
      : result.notes,
  };
}
