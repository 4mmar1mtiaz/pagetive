import { structured } from "@/lib/llm";
import { BLOCK_REFERENCE, normalizeBlocks, type Block, type ThemeTokens } from "@/lib/blocks";
import { readPage, readTheme, type ScrapedImage } from "@/lib/scrape";

/** A browser user-agent. Some hosts serve a bot-flavoured shell otherwise. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/**
 * The page's real stylesheets, not just whatever CSS happened to be inline.
 *
 * One page measured here linked forty-eight of them, which is why reading the
 * accent out of the markup alone found nothing on most sites. Capped hard: this
 * runs inside a request, and a theme is not worth a timeout.
 */
async function styles(html: string, urls: string[]): Promise<string> {
  const inline = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join("\n") ?? "";
  const fetched = await Promise.all(
    urls.slice(0, 3).map(async (u) => {
      try {
        const res = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) return "";
        return (await res.text()).slice(0, 400000);
      } catch {
        return "";
      }
    }),
  );
  return [inline, ...fetched].join("\n");
}

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

export type ImportResult = {
  /** Where the page ended up after redirects. */
  url: string;
  /** Every picture the page carried, for the caller to copy into storage. */
  images: ScrapedImage[];
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
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  }).catch((err: Error) => {
    throw new Error(`Could not reach ${target.hostname}: ${err.message}`);
  });

  if (!res.ok) throw new Error(`${target.hostname} returned HTTP ${res.status}.`);

  const html = await res.text();
  // The base is the URL after redirects: a relative image on a page that moved
  // resolves against where it ended up, not where it was asked for.
  const page = readPage(html, res.url || target.toString());

  if (page.outline.length < 200) {
    throw new Error(
      `${target.hostname} returned almost no readable text. It is probably rendered entirely in JavaScript. Paste the copy in chat instead and I will build the page from that.`,
    );
  }

  const theme = readTheme(await styles(html, page.cssUrls));

  const result = await structured<{ name: string; goal: string; notes: string; blocksJson: string }>({
    system: `You convert an existing landing page into a structured block model.

${BLOCK_REFERENCE}

You are reading the page in document order. Each line is one thing found on it,
labelled with what produced it:

  [h1] [h2] [p] [li] [button] [blockquote] ...   copy, from that element
  [img] URL alt="..." WxH                        a picture, where it appeared
  [video] URL                                    a video
  [embed] URL                                    an iframe: a booker, a form, a map
  [link] text -> URL                             a link or button and its target
  [field] name= type= placeholder= required      one input in a form
  [nav:...] [footer:...] [aside:...]             inside site chrome
  [consent:...]                                  a cookie or consent dialog

Your job is reconstruction, not redesign:
- Keep the owner's actual copy wherever it is usable. Do not rewrite their
  offer, their prices, or their claims.
- KEEP THEIR PICTURES. An [img] line tells you a picture was at that point in
  the page, so put it on the block you build from the copy around it: use the
  URL exactly as given, as imageUrl or mediaUrl, with layout saying where it
  sat. Alt text comes from the alt in the line. A page imported without its
  images does not look like the page they asked you to import. Skip only
  obvious chrome: icons under 64px, and anything inside [nav:] or [footer:].
- A row of small images inside [nav:] or near words like "trusted by" is a
  logos block, one item per image.
- REBUILD THEIR FORM from the [field] lines: same names, same types, same
  required flags, in the same order. Do not substitute a generic name/email/
  phone form for a form that asked for six things.
- An [embed] pointing at a scheduler is a calendar block. Any other [embed]
  that is part of the offer is an embed block with that URL and an embedKind.
- [link] targets are the real CTA hrefs. A button that pointed at their signup
  keeps pointing there. Only send a CTA to "#form" if you built the form.
- Drop [nav:], [footer:], [consent:] and legal boilerplate. Keep the selling
  content.
- If the source has no conversion path at all, add a form block with name,
  email and phone, and say so in notes.
- Do not invent testimonials, logos, statistics or guarantees that are not in
  the source.

Return blocksJson as a JSON string containing the block array.`,
    prompt: `URL: ${res.url || target.toString()}
Title: ${page.title || "(none)"}
Meta description: ${page.description || "(none)"}
OG title: ${page.ogTitle || "(none)"}
OG image: ${page.ogImage || "(none)"}
Detected theme: ${JSON.stringify(theme)}
${page.dropped.length ? `Skipped during extraction: ${page.dropped.join(", ")}\n` : ""}
Page:
${page.outline}`,
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
    url: res.url || target.toString(),
    images: page.ogImage
      ? [{ url: page.ogImage, alt: "", w: 0, h: 0, region: "", context: "", logoHint: false, background: false }, ...page.images]
      : page.images,
    name: result.name || page.title || target.hostname,
    goal: result.goal ?? "",
    notes: result.notes ?? "",
    blocks,
    theme,
  };
}
