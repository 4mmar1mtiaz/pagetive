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
  | "menu"
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
  | "media"
  | "embed"
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
    /** logo, screenshot or headshot for this item */
    imageUrl?: string;
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
  /**
   * Any embeddable URL: a scheduler, a form somebody built elsewhere, a map, a
   * video host, a dashboard. On a calendar block this is the scheduler and a
   * blank falls back to the page's default one; on an embed block it is
   * whatever the user wants in the page.
   */
  embedUrl?: string;
  height?: number;
  /**
   * What the embed is, when it is not obvious from the URL. The only one that
   * changes behaviour is "form": a page whose conversion path is somebody
   * else's form still has a conversion path, and the checker needs to know.
   */
  embedKind?: "form" | "calendar" | "video" | "map" | "other";
  /** media — an uploaded image or video, and anywhere else one is shown */
  mediaUrl?: string;
  mediaKind?: "image" | "video";
  /** Video playback. Muted is forced whenever autoplay is on; browsers require it. */
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  /** The still shown before a video plays. */
  poster?: string;
  /** "contain" shows the whole picture. "cover" fills the space and crops. */
  mediaFit?: "contain" | "cover";
  /** Cap on how tall the picture, video or embed is allowed to be, in pixels. */
  mediaHeight?: number;
  /**
   * Where the block's picture, video, embed or form sits relative to its copy.
   *
   * Every block takes one, not just the media blocks: a features grid with a
   * photograph down its left side is a normal thing to want, and there is no
   * reason the block vocabulary should be the thing standing in the way.
   *
   *   stack  under the copy (the default)
   *   left   beside the copy, on the left
   *   right  beside the copy, on the right
   *   wide   under the copy, the full width of the content column
   *   full   under the copy, edge to edge of the screen
   */
  layout?: "stack" | "left" | "right" | "wide" | "full";
  /** A video playing behind this section, in place of a background picture. */
  bgVideoUrl?: string;
  /** Describes the image for screen readers and for search. Never decorative text. */
  alt?: string;
  caption?: string;
  /** hero / cta / richtext: a single image beside or beneath the copy */
  imageUrl?: string;
  /** footer and menu */
  links?: { label?: string; href?: string }[];
  /**
   * Menu placement. A menu is allowed anywhere the user asks for it: pinned to
   * the top, pinned to the bottom, standing in a box down the left or right, or
   * sitting in the flow of the page where the block happens to be. "top" is the
   * default only because a page whose owner said nothing about a menu should
   * still look like a page.
   */
  placement?: "top" | "bottom" | "left" | "right" | "inline";
  /** A top or bottom menu that stays with the visitor as they scroll. */
  sticky?: boolean;

  /**
   * Section background.
   *
   * Any block can carry its own picture or its own colour behind it, and two
   * neighbouring blocks can carry different ones. The image is a background,
   * not content: it is cropped to the section and never stretched, so `alt`
   * does not apply to it. Anything a screen reader needs to know belongs in a
   * media or hero image instead.
   */
  bgImageUrl?: string;
  bgColor?: string;
  /** 0 to 1. A scrim between the picture and the copy. Text over a photo needs one. */
  bgOverlay?: number;
  /** Which part of the picture survives the crop. Default center. */
  bgFocus?: "center" | "top" | "bottom" | "left" | "right";
  /** The picture holds still while the content scrolls over it. */
  bgFixed?: boolean;
  /** The content of this block sits in a translucent panel over its background. */
  panel?: boolean;
  /**
   * One picture deliberately split across several blocks.
   *
   * Off by default and it should stay off: blocks are reordered by variants and
   * by the optimiser, and the halves of a split picture do not travel together.
   * It exists because a user who has been told that and still wants it is
   * entitled to have it.
   */
  bgSlice?: { part?: number; of?: number };
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

  /**
   * One picture behind the whole page, rather than one per section.
   *
   * This is the other legitimate way to use a photograph, and the only safe way
   * to get continuity: the image belongs to the page, so reordering sections
   * cannot break it. A page-level background sits under every block that does
   * not set its own.
   */
  bgImageUrl?: string;
  /** A video behind the whole page instead of a picture. Muted and looping. */
  bgVideoUrl?: string;
  bgOverlay?: number;
  bgFixed?: boolean;
  /** Every section's content sits in a translucent glass panel over that picture. */
  panels?: boolean;
  /**
   * Which way the page travels as the visitor scrolls.
   *
   * "down" is an ordinary page. "left" lays the sections out in a row and the
   * page moves sideways, the normal reading direction. "right" is the same
   * thing mirrored. Sideways is a real request and not a mistake to be talked
   * out of; it is a default only in the sense that nobody gets it by accident.
   */
  scroll?: "down" | "left" | "right";
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
  bgImageUrl: "",
  bgVideoUrl: "",
  bgOverlay: 0,
  bgFixed: false,
  panels: false,
  scroll: "down",
};

export function theme(t: ThemeTokens | undefined): Required<ThemeTokens> {
  return { ...DEFAULT_THEME, ...(t ?? {}) };
}

/**
 * The block a visitor has to reach for the page to have worked.
 *
 * Shared because three places ask the question and they must agree: the funnel
 * labels a step with it, the simulator decides where a fake visitor converts,
 * and the copy checker refuses a page that has none. An embedded form or
 * scheduler counts. A page whose whole conversion path is somebody else's
 * Typeform is not a page without a conversion path.
 */
export function isGoalBlock(b: Block): boolean {
  if (b.type === "form" || b.type === "calendar") return true;
  return Boolean(b.embedUrl) && (b.embedKind === "form" || b.embedKind === "calendar");
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

menu      - links[{label, href}], ctaText, ctaHref, imageUrl (a logo), headline (a
            wordmark when there is no logo), placement, sticky
hero      - eyebrow, headline, subhead, ctaText, ctaHref, secondaryCtaText, secondaryCtaHref, ctaNote, align, imageUrl, alt
logos     - headline, items[{name, imageUrl}]
features  - eyebrow, headline, subhead, items[{title, body, imageUrl}]
steps     - headline, subhead, items[{title, body}]  (rendered numbered)
stats     - headline, items[{value, label}]
proof     - headline, items[{quote, author, role, imageUrl}]
pricing   - headline, subhead, plans[{name, price, period, blurb, features[], ctaText, ctaHref, highlight}]
faq       - headline, items[{q, a}]
form      - headline, subhead, fields[{name, label, type, placeholder, required, options}], submitText, successMessage
            field type is one of text | email | tel | textarea | select
calendar  - headline, subhead, embedUrl, height   (embedUrl blank falls back to the page's default scheduler)
cta       - headline, subhead, ctaText, ctaHref, ctaNote
richtext  - headline, body   (body may use plain line breaks, no markup)
media     - headline, subhead, mediaUrl, mediaKind ("image" or "video"), alt, caption
embed     - headline, subhead, embedUrl, embedKind, height, caption
            anything that lives in an iframe: a form built somewhere else, a
            map, a video host, a booking widget, a dashboard. embedKind is
            form | calendar | video | map | other.
footer    - body, links[{label, href}]

MEDIA AND PLACEMENT. Every block above accepts a picture, a video or an embed,
and a layout saying where it goes. Not just the media blocks. A features grid
with a photograph down its left side, a pricing table with a demo video under it,
an FAQ next to a map: all of these are one field, and you should use them.

  imageUrl    a picture on this block
  mediaUrl    a picture or a video, with mediaKind "image" or "video"
  embedUrl    an iframe on this block, with embedKind
  layout      stack (under the copy, the default) | left | right (beside the
              copy) | wide (full content width) | full (edge to edge)
  mediaFit    contain shows the whole picture, cover fills the space and crops
  mediaHeight a cap in pixels, when the default is the wrong size
  alt         what the picture shows, always, for anything that is content
  caption     a line under it
  autoplay, loop, muted, controls, poster   video playback. Autoplay forces
              muted, because every browser does. A video that matters gets
              controls; a video that is decoration gets autoplay, loop, muted.

Grid items take pictures too: features items[{imageUrl}] renders it above the
title, proof items[{imageUrl}] renders it as the reviewer's face, logos
items[{imageUrl}] is the logo itself.

EMBEDS. Anything with an embeddable URL goes on the page, wherever they want it.
Somebody else's form, a Cal.com or Calendly booking widget, a Google Map, a
YouTube or Loom or Vimeo video, a Typeform, a spreadsheet, a dashboard. Use an
embed block for it, or put embedUrl on any other block to place it beside that
block's copy. Set embedKind, and set height when the thing has an obvious one.
An embed whose embedKind is "form" or "calendar" counts as the page's conversion
path, so a page built around somebody else's form does not need a second one.

BACKGROUNDS. Every block above also accepts these, and you may use them without
asking. A page of flat panels is not more professional than a page with pictures
in it; it is just emptier.

  bgImageUrl  a picture behind this section, cropped to fill it
  bgColor     a colour behind this section, instead of the alternating surface
  bgOverlay   0 to 1, a scrim between the picture and the copy
  bgFocus     center | top | bottom | left | right, what survives the crop
  bgFixed     true holds the picture still while the content scrolls over it
  bgVideoUrl  a video behind this section instead of a picture, muted and looping
  panel       true puts this section's content in a translucent glass panel
  bgSlice     {part, of} - one picture split across several blocks. See below.

Sections are independent: different sections can carry different pictures, and
that is the normal way to use them. Text over a photograph needs bgOverlay,
usually around 0.5. A headline nobody can read is a broken page.

THE CONTINUITY RULE. Never split one picture across two blocks or two columns so
that it reads as a single continuous image. Blocks get reordered: a variant can
rewrite them, the optimiser serves different orders to different people, and the
user drags them around later. The two halves do not travel together, so the
picture comes apart and nobody is watching when it does. Want one image spanning
the whole page? Put it on the theme as bgImageUrl. It belongs to the page, so
nothing can pull it apart.

If the user asks for a sliced image anyway, tell them that once, in one sentence,
and offer the page background instead. If they ask again, build it with bgSlice:
the same bgImageUrl on each block, {part: 1, of: 2} then {part: 2, of: 2}, in
order. Do not argue twice. It is their page.

THE PAGE ITSELF. These are theme tokens, not block fields, and they are how a
page stops looking like every other page:

  bgImageUrl  one picture behind the entire page
  bgVideoUrl  a video behind the entire page instead
  bgOverlay   the scrim over it
  bgFixed     true keeps it still while everything scrolls over it
  panels      true floats every section in a glass panel over that picture
  scroll      "down" (ordinary), "left" (sideways, the usual direction), or
              "right" (sideways, mirrored)

MENUS. A menu block is allowed, and it goes where the user asked. placement is
"top", "bottom", "left", "right", or "inline" (wherever the block sits in the
order). Top and bottom menus take sticky. Left and right menus stand in a fixed
box down that edge of the screen, and the page makes room for them.

When the user said nothing about a menu, the default is: a menu block first,
placement "top", sticky true, three to five links pointing at sections that
actually exist on the page, and one CTA pointing at the conversion path. Every
section is an anchor named after its block id, so the links are "#features-1",
"#pricing-1", "#faq-1", and the conversion path is always "#form" or
"#calendar". Never link to a section the page does not have. When the user did say, what they said wins over
every default here and you build it as described without talking them out of it.

LINKING TO THE APP. "/sign-up" and "/sign-in" are real routes. Use them as
ctaHref whenever the action is "start using this product" rather than "send us
your details" — a marketing page for the product itself wants sign-up, not a
lead form. They are rewritten to the app's own domain at render time, so they
keep working on a page served from a customer hostname. Write them exactly as
"/sign-up" and "/sign-in"; do not build an absolute URL yourself.

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

5. Every page needs a conversion path: a form block, a calendar block, or an
   embed block whose embedKind is "form" or "calendar". Every CTA above it
   points at it ("#form", "#calendar", or that embed block's id).

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
