import { structured } from "@/lib/llm";
import { BLOCK_REFERENCE, normalizeBlocks, type Block, type ThemeTokens } from "@/lib/blocks";

/**
 * Turning somebody else's live page into our block model.
 *
 * This is the riskiest single step in the product. A customer's first page is
 * imported, not invented, and if the importer produces mush on a stranger's
 * messy HTML then everything downstream — variants, angles, the whole "make it
 * once" promise — is built on mush.
 *
 * The approach is deliberately not "parse the DOM into blocks". Real pages are
 * div soup from a dozen page builders, and structural parsing gets 60% of the
 * way on the tidy ones and nowhere on the rest. Instead we extract the visible
 * text in document order with light structural hints, and let the model
 * reconstruct intent. Losing the exact layout is fine; losing the copy and the
 * offer is not.
 */

const MAX_CHARS = 60000;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/&[a-z]+;/gi, " ");
}

/** Visible text, in order, with the tag that produced it kept as a hint. */
function outline(html: string): string {
  const body = stripTags(html);
  const lines: string[] = [];
  const re = /<(h1|h2|h3|h4|p|li|a|button|blockquote|label|span|td|summary)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tag = m[1].toLowerCase();
    const text = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text || text.length > 600) continue;
    // Nav crumbs and one-word spans add noise without adding meaning.
    if (text.length < 2) continue;
    if (tag === "span" && text.length < 12) continue;
    lines.push(`[${tag}] ${text}`);
  }
  // Consecutive duplicates come from wrapper elements repeating their child's text.
  const deduped = lines.filter((l, i) => l !== lines[i - 1]);
  return deduped.join("\n").slice(0, MAX_CHARS);
}

function meta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (m) return decode(m[1]).trim();
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? decode(m2[1]).trim() : "";
}

/** The most-used non-neutral hex in the stylesheet is nearly always the brand accent. */
function guessAccent(html: string): string | undefined {
  const counts: Record<string, number> = {};
  const re = /#([0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hex = `#${m[1].toLowerCase()}`;
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Skip greys, near-blacks and near-whites: they are chrome, not brand.
    if (max - min < 40) continue;
    if (max < 40 || min > 220) continue;
    counts[hex] = (counts[hex] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0];
}

export type ImportResult = {
  name: string;
  goal: string;
  blocks: Block[];
  theme: ThemeTokens;
  notes: string;
};

/**
 * `blocksJson` is a string, not an array of objects.
 *
 * Structured outputs require every object in the schema to be closed
 * (`additionalProperties: false`), and a block is open by design — thirteen
 * types sharing one loose shape. Enumerating all of them as a discriminated
 * union would be several hundred lines that has to be kept in step with
 * blocks.ts by hand. A JSON string keeps one source of truth; the reference
 * prose in BLOCK_REFERENCE is what constrains the content.
 */
const IMPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "goal", "blocksJson", "notes"],
  properties: {
    name: { type: "string", description: "Short internal name for this page" },
    goal: { type: "string", description: "One sentence: what this page is trying to get the visitor to do" },
    notes: {
      type: "string",
      description:
        "What you could not recover from the source and what the owner should check. Be specific and honest.",
    },
    blocksJson: {
      type: "string",
      description: "The block array, serialised as JSON.",
    },
  },
} as const;

export async function importPage(
  url: string,
  accountId?: string,
  apiKey?: string,
): Promise<ImportResult> {
  let target: URL;
  try {
    target = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    throw new Error(`"${url}" is not a URL.`);
  }

  const res = await fetch(target.toString(), {
    headers: {
      // Some hosts serve a bot-flavoured page to unrecognised agents, which
      // imports as an empty shell. Ask for the human version.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  }).catch((err: Error) => {
    throw new Error(`Could not reach ${target.hostname}: ${err.message}`);
  });

  if (!res.ok) throw new Error(`${target.hostname} returned HTTP ${res.status}.`);

  const html = await res.text();
  const text = outline(html);

  if (text.length < 200) {
    throw new Error(
      `${target.hostname} returned almost no readable text. It is probably rendered entirely in JavaScript — paste the copy in chat instead and I will build the page from that.`,
    );
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const accent = guessAccent(html);

  const result = await structured<{ name: string; goal: string; notes: string; blocksJson: string }>({
    system: `You convert an existing landing page into a structured block model.

${BLOCK_REFERENCE}

You are reading a text outline of the page in document order. Tags in brackets are the source element. Your job is reconstruction, not redesign:
- Keep the owner's actual copy wherever it is usable. Do not rewrite their offer, their prices, or their claims.
- Drop site navigation, cookie banners, legal boilerplate and blog chrome. Keep the selling content.
- If the source has a form, recreate its fields. If it has a booking widget, emit a calendar block.
- If the source is missing an obvious conversion path, add a form block with name/email/phone and say so in notes.
- Do not invent testimonials, logos, statistics or guarantees that are not in the source.

Return blocksJson as a JSON string containing the block array.`,
    prompt: `URL: ${target.toString()}
Title: ${title}
Meta description: ${meta(html, "description") || "(none)"}
OG title: ${meta(html, "og:title") || "(none)"}

Page outline:
${text}`,
    schema: IMPORT_SCHEMA as unknown as Record<string, unknown>,
    kind: "import",
    accountId,
    apiKey,
    maxTokens: 32000,
  });

  const blocks = normalizeBlocks(JSON.parse(result.blocksJson || "[]"));
  if (blocks.length === 0) {
    throw new Error(
      `Read ${target.hostname} but could not turn it into blocks. Paste the copy into chat and I will build it directly.`,
    );
  }

  return {
    name: result.name || title || target.hostname,
    goal: result.goal ?? "",
    notes: result.notes ?? "",
    blocks,
    theme: accent ? { accent } : {},
  };
}
