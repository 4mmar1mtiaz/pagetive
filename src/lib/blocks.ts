/**
 * The block vocabulary.
 *
 * A page is an ordered list of typed blocks, never HTML. Two things depend on
 * that: the renderer can style every page consistently without parsing anyone's
 * markup, and a variant can override one field of one block instead of swapping
 * a whole document. The moment a page becomes an HTML string, per-angle
 * personalisation stops being possible — so no block carries raw markup.
 *
 * Every field is optional at the type level and defaulted at render time. The
 * blocks come out of an LLM; a missing `subhead` must produce a page with no
 * subhead, not a crash.
 */

export type BlockType =
  | "hero"
  | "logos"
  | "features"
  | "steps"
  | "stats"
  | "proof"
  | "pricing"
  | "faq"
  | "form"
  | "calendar"
  | "cta"
  | "richtext"
  | "footer";

export type FormField = {
  name: string;
  label?: string;
  type?: "text" | "email" | "tel" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: string[];
};

export type Block = {
  id: string;
  type: BlockType;
  /** hero / cta / richtext / section headers */
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  body?: string;
  align?: "left" | "center";
  /** call to action */
  ctaText?: string;
  ctaHref?: string;
  ctaNote?: string;
  secondaryCtaText?: string;
  secondaryCtaHref?: string;
  /** repeated content: features, steps, stats, proof, faq, logos */
  items?: {
    title?: string;
    body?: string;
    icon?: string;
    value?: string;
    label?: string;
    quote?: string;
    author?: string;
    role?: string;
    q?: string;
    a?: string;
    name?: string;
  }[];
  /** pricing */
  plans?: {
    name?: string;
    price?: string;
    period?: string;
    blurb?: string;
    features?: string[];
    ctaText?: string;
    ctaHref?: string;
    highlight?: boolean;
  }[];
  /** form */
  fields?: FormField[];
  submitText?: string;
  successMessage?: string;
  /** calendar — any embeddable scheduler URL (Cal.com, Calendly, TidyCal, ...) */
  embedUrl?: string;
  height?: number;
  /** footer */
  links?: { label?: string; href?: string }[];
};

export type ThemeTokens = {
  mode?: "dark" | "light";
  accent?: string;
  accentSoft?: string;
  bg?: string;
  surface?: string;
  text?: string;
  muted?: string;
  radius?: number;
  font?: string;
  density?: "tight" | "normal" | "roomy";
};

export type PageSettings = {
  /** Every lead is POSTed here as JSON. Works with GHL, Zapier, Make, n8n, any CRM inbound hook. */
  crmWebhookUrl?: string;
  /** Comma-separated. Emailed on each lead when RESEND_API_KEY is configured. */
  notifyEmail?: string;
  /** Default scheduler embed, used when a calendar block leaves embedUrl blank. */
  calendarUrl?: string;
  /** Where the visitor goes after submitting. Blank shows the inline success message. */
  redirectUrl?: string;
  /** Off means no tracker script, no events, no heatmap. On by default. */
  tracking?: boolean;
};

/** A hard routing rule: when the URL matches, this variant is served outright. */
export type MatchRule = {
  param?: string;
  contains?: string;
};

export type Overrides = Record<string, Partial<Block>>;

export const DEFAULT_THEME: Required<ThemeTokens> = {
  mode: "dark",
  accent: "#c9d2dc",
  accentSoft: "#7d8794",
  bg: "#0a0c10",
  surface: "#12151b",
  text: "#eef1f5",
  muted: "#98a2b0",
  radius: 16,
  font: "Inter",
  density: "normal",
};

export function theme(t: ThemeTokens | undefined): Required<ThemeTokens> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

/** Stable, human-readable block ids — variants reference them by name. */
export function blockId(type: BlockType, index: number): string {
  return `${type}-${index + 1}`;
}

/** Ids are the join key between master blocks and variant overrides, so they
 *  are assigned here rather than trusted from the model. */
export function normalizeBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) return [];
  const counts: Record<string, number> = {};
  return input
    .filter((b): b is Block => Boolean(b) && typeof b === "object" && typeof (b as Block).type === "string")
    .map((b) => {
      const type = b.type;
      counts[type] = (counts[type] ?? 0) + 1;
      return { ...b, type, id: b.id && typeof b.id === "string" ? b.id : `${type}-${counts[type]}` };
    });
}

/** Master + variant overrides, merged one block at a time. */
export function applyOverrides(blocks: Block[], overrides: Overrides): Block[] {
  if (!overrides || Object.keys(overrides).length === 0) return blocks;
  return blocks.map((b) => (overrides[b.id] ? { ...b, ...overrides[b.id], id: b.id, type: b.type } : b));
}

/**
 * The block reference handed to the model on every generation call.
 *
 * Written as prose rather than a JSON Schema on purpose: the model composes a
 * whole page in one tool call, and a schema strict enough to be useful here
 * would be longer than the description and still not express "a hero should
 * lead with the promise, not the product name".
 */
export const BLOCK_REFERENCE = `A page is a JSON array of blocks. Each block is an object with a "type" and the fields listed for that type. Omit fields you do not need. Never emit HTML.

hero      - eyebrow, headline, subhead, ctaText, ctaHref, secondaryCtaText, secondaryCtaHref, ctaNote, align
logos     - headline, items[{name}]
features  - eyebrow, headline, subhead, items[{title, body}]
steps     - headline, subhead, items[{title, body}]  (rendered numbered)
stats     - headline, items[{value, label}]
proof     - headline, items[{quote, author, role}]
pricing   - headline, subhead, plans[{name, price, period, blurb, features[], ctaText, ctaHref, highlight}]
faq       - headline, items[{q, a}]
form      - headline, subhead, fields[{name, label, type, placeholder, required, options}], submitText, successMessage
            field type is one of text | email | tel | textarea | select
calendar  - headline, subhead, embedUrl, height   (embedUrl blank falls back to the page's default scheduler)
cta       - headline, subhead, ctaText, ctaHref, ctaNote
richtext  - headline, body   (body may use plain line breaks, no markup)
footer    - body, links[{label, href}]

HARD RULES. These are not style preferences; a page that breaks one is wrong.

1. NO EMOJI. Not in headlines, not in body copy, not as icons, not anywhere. The
   "icon" field is deprecated: never set it. An emoji in a section heading makes
   a paid landing page look like a side project.

2. NO EM DASHES OR EN DASHES. Never the characters - or -. Use a full stop, a
   comma, a colon, or the word "and". Two short sentences beat one spliced
   sentence. This is the single most recognisable tell of generated copy.

3. FILL EVERY GRID. Repeated items render into a responsive grid, and a row with
   one orphan item on it looks broken.
   - features, steps, proof: use exactly 3 or exactly 6 items.
   - stats: use exactly 2, 4, or 8 items.
   - logos: 4 or more.
   Never 4 or 5 features. If you only have 4 real points, cut to 3 or find a
   genuine sixth. The only exception is when the user explicitly asks for a
   specific number.

4. NO SMART QUOTES OR SPECIAL CHARACTERS in copy. Straight apostrophes only.
   No arrows, no bullets, no typographic ornaments.

5. Every page needs exactly one conversion path: a form block, a calendar block,
   or both. Every CTA above it points at it ("#form" or "#calendar").

6. NEVER INVENT FACTS. No statistics, customer names, review counts, prices,
   certifications, guarantees, response times, or years in business unless they
   were given to you. Write the benefit without the number instead.

COPY STANDARD. The difference between a page that converts and a page that reads
like a template is entirely here.

- A headline makes a specific promise. "Roof leak fixed today or you do not pay"
  is a headline. "Elevate your roofing experience" is filler.
- Lead with what the reader gets, not what the company is. Never open a page
  with the company describing itself.
- Every sentence must survive the question "could a competitor say this too?"
  If yes, it is not selling anything. Cut it or make it concrete.
- Ban list, never use: unlock, elevate, seamless, cutting-edge, revolutionary,
  game-changing, world-class, best-in-class, empower, leverage, robust,
  solutions, journey, transform your business, take it to the next level,
  "we are passionate about".
- Body copy is two or three sentences. Nobody reads a paragraph on a landing
  page. Say the thing and stop.
- Vary sentence length. Three sentences of identical rhythm reads as machine
  output even when every word is right.
- Write in the register of the business. A roofer and a legal SaaS do not sound
  alike, and a page that sounds like neither sounds like software.`;
