import type { ThemeTokens } from "@/lib/blocks";

/**
 * Reading somebody else's page.
 *
 * Split out of the importer because extraction and reconstruction are two
 * different jobs with two different failure modes, and because the ad
 * libraries need the same thing: turn a page of markup into an ordered
 * description a model can reason about.
 *
 * The previous version of this matched a fixed list of text tags with a
 * non-greedy regex and threw everything else away. Measured against one real
 * page, that meant twenty images, seventy-two links, every form field and every
 * stylesheet never reached the model, and nested elements collapsed a cookie
 * banner and the whole navigation into a single "paragraph". A page reduced to
 * anonymous prose imports as anonymous prose.
 *
 * So this walks the document once, in order, and keeps the things a landing
 * page is actually made of: what the copy says, which picture sat next to it,
 * where the buttons pointed, and what the form asked for.
 */

/**
 * Elements whose contents are not page copy.
 *
 * Note what is missing: <head>. Skipping it wholesale is what made the theme
 * unreadable, because every stylesheet a page links is in there and none of
 * them were ever seen. <title> and <meta> are read separately by regex, so the
 * head contributes nothing to the outline anyway.
 */
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "select", "title"]);

/** Elements whose contents are text to the parser, never tags. */
const RAW = new Set(["script", "style", "title", "template"]);

/** Elements that end a run of text, because their text is a unit of meaning. */
const FLUSH = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "blockquote", "button", "summary", "label",
  "td", "th", "figcaption", "dt", "dd", "legend", "div", "section", "article",
]);

/** Elements whose contents are chrome rather than the offer. */
const REGION = new Set(["nav", "footer", "aside"]);

const VOID = new Set([
  "img", "input", "br", "hr", "meta", "link", "source", "area",
  "base", "col", "embed", "param", "track", "wbr",
]);

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>|([^<]+)|</g;

const LIMITS = { chars: 60000, images: 60, links: 140, fields: 40 };

/** Cookie walls and consent dialogs, which every page has and none sell with. */
const CONSENT = /\b(cookies?|consent|privacy preference|accept all|reject all|gdpr)\b/i;

export function decode(text: string): string {
  return (
    text
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;|&#38;/g, "&")
      .replace(/&lt;|&#60;/g, "<")
      .replace(/&gt;|&#62;/g, ">")
      .replace(/&quot;|&#34;/g, '"')
      .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;|&#8217;|&#8216;/g, "'")
      .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
      .replace(/&mdash;|&#8212;|&ndash;|&#8211;/g, " - ")
      .replace(/&hellip;|&#8230;/g, "...")
      .replace(/&[a-z]+;|&#\d+;/gi, " ")
      // Typography the block rules ban outright. Normalising it here means the
      // owner's sentence survives import; leaving it means the editor pass
      // rewrites the sentence to get rid of a punctuation mark.
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/…/g, "...")
  );
}

function attr(attrs: string, name: string): string {
  const m =
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ??
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i")) ??
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"));
  return m ? decode(m[1]).trim() : "";
}

function has(attrs: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(attrs);
}

/** A relative src on someone else's page is useless to us the moment we store it. */
export function absolute(base: string, url: string): string {
  if (!url) return "";
  if (/^(data|blob|javascript|mailto|tel):/i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return "";
  }
}

/** The biggest candidate in a srcset, which is the one worth keeping. */
function fromSrcset(srcset: string): string {
  let best = "";
  let bestW = -1;
  for (const part of srcset.split(",")) {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) continue;
    const w = bits[1]?.endsWith("w") ? parseInt(bits[1], 10) : bits[1]?.endsWith("x") ? parseFloat(bits[1]) * 1000 : 0;
    if (w >= bestW) {
      bestW = w;
      best = bits[0];
    }
  }
  return best;
}

export type ScrapedImage = {
  url: string;
  alt: string;
  /** Declared in the markup, 0 when it was not. The real size comes from lib/site-images. */
  w: number;
  h: number;
  /** nav, footer, aside, or "" for the body of the page. */
  region: string;
  /** The last heading above it: what the picture was illustrating. */
  context: string;
  /** Its src, alt, class or id says "logo". */
  logoHint: boolean;
  /** A CSS background rather than an <img>, which is usually a hero or a banner. */
  background: boolean;
};

/** A lazy loader's placeholder, not the picture. */
function placeholder(src: string): boolean {
  return !src || src.startsWith("data:") || /(?:blank|spacer|placeholder|lazy)[^/]*\.(?:gif|png|svg)/i.test(src);
}

/** Where the real file is, on pages that swap it in with JavaScript after load. */
function imageSrc(attrs: string): string {
  const src = attr(attrs, "src");
  if (!placeholder(src)) return src;
  for (const name of ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-url"]) {
    const v = attr(attrs, name);
    if (v && !v.startsWith("data:")) return v;
  }
  const set = attr(attrs, "srcset") || attr(attrs, "data-srcset") || attr(attrs, "data-lazy-srcset");
  if (set) return fromSrcset(set);
  return src;
}

const BG_URL = /background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;

export type Scraped = {
  outline: string;
  title: string;
  description: string;
  ogTitle: string;
  ogImage: string;
  images: ScrapedImage[];
  /** Same-origin stylesheets, in order, so the theme can be read from real CSS. */
  cssUrls: string[];
  /** apple-touch-icon and friends: a square mark, the logo of last resort. */
  icons: string[];
  /** Same-site pages it links to, with their anchor text, for a second read. */
  pages: { url: string; text: string }[];
  /** tel: and mailto: targets, which is how a page states its contact details. */
  phones: string[];
  emails: string[];
  /** What the walk had to leave out, so the caller can say so honestly. */
  dropped: string[];
};

export function meta(html: string, name: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (m) return decode(m[1]).trim();
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? decode(m2[1]).trim() : "";
}

/**
 * One pass over the document, emitting an annotated outline in source order.
 *
 * Order is the whole point. "There is an image here, between this headline and
 * that paragraph" is what tells a model the picture belongs to the hero rather
 * than to the footer, and no amount of listing the images separately recovers
 * it.
 */
export function readPage(html: string, baseUrl: string): Scraped {
  let base = baseUrl;
  const out: string[] = [];
  const images: ScrapedImage[] = [];
  const cssUrls: string[] = [];
  const icons: string[] = [];
  const pages: { url: string; text: string }[] = [];
  const phones = new Set<string>();
  const emails = new Set<string>();
  const dropped: string[] = [];
  let heading = "";

  let skip = 0;
  const regions: string[] = [];
  let buf: string[] = [];
  let label = "";
  let links = 0;
  let fields = 0;
  let chars = 0;

  const region = () => (regions.length ? `${regions[regions.length - 1]}:` : "");

  const emit = (line: string) => {
    if (chars >= LIMITS.chars) return;
    chars += line.length + 1;
    out.push(line);
  };

  const flush = () => {
    const text = decode(buf.join(" ")).replace(/\s+/g, " ").trim();
    buf = [];
    const tag = label;
    label = "";
    if (!text || text.length < 2 || text.length > 900) return;
    if (/^h[1-4]$/.test(tag) && !regions.length) heading = text.slice(0, 120);
    const prefix = CONSENT.test(text) && text.length < 300 ? "consent:" : region();
    emit(`[${prefix}${tag || "text"}] ${text}`);
  };

  const lower = html.toLowerCase();
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html)) !== null) {
    const [, closing, rawTag, attrs = "", selfClose, text] = m;

    if (text !== undefined) {
      if (!skip) buf.push(text);
      continue;
    }
    if (!rawTag) continue; // a comment
    const tag = rawTag.toLowerCase();

    if (tag === "link" && !closing) {
      const rel = attr(attrs, "rel");
      if (/stylesheet/i.test(rel)) {
        const href = absolute(base, attr(attrs, "href"));
        if (href && cssUrls.length < 4) cssUrls.push(href);
      } else if (/apple-touch-icon|(?:^|\s)icon\b/i.test(rel)) {
        const href = absolute(base, attr(attrs, "href"));
        if (href && !href.startsWith("data:")) icons.push(href);
      }
      continue;
    }
    // <base href> reassigns what every relative URL on the page means.
    if (tag === "base" && !closing) {
      const href = attr(attrs, "href");
      if (href) base = absolute(base, href) || base;
      continue;
    }

    // Raw text: whatever is inside is not markup, even when it looks like it. A
    // script holding the string "<template>" would otherwise open a skip that
    // never closes, and the rest of the page would silently read as empty.
    if (RAW.has(tag) && !closing && !selfClose) {
      const end = lower.indexOf(`</${tag}`, TOKEN.lastIndex);
      if (end === -1) break;
      const gt = html.indexOf(">", end);
      TOKEN.lastIndex = gt === -1 ? html.length : gt + 1;
      continue;
    }

    if (SKIP.has(tag)) {
      if (closing) skip = Math.max(0, skip - 1);
      else if (!selfClose) skip += 1;
      continue;
    }
    if (skip) continue;

    if (REGION.has(tag)) {
      flush();
      if (closing) regions.pop();
      else regions.push(tag);
      continue;
    }

    if (closing) {
      if (FLUSH.has(tag)) flush();
      continue;
    }

    // --- things that are not text -------------------------------------------
    // A section painted with a picture in its style attribute. Hero banners are
    // built this way far more often than with an <img>.
    if (!closing && !VOID.has(tag)) {
      const bg = attr(attrs, "style").match(BG_URL)?.[1] ?? attr(attrs, "data-bg") ?? "";
      const src = bg && !bg.startsWith("data:") ? absolute(base, bg) : "";
      if (src && images.length < LIMITS.images && !images.some((i) => i.url === src)) {
        images.push({ url: src, alt: "", w: 0, h: 0, region: regions.at(-1) ?? "", context: heading, logoHint: false, background: true });
        flush();
        emit(`[${region()}bgimg] ${src}`);
      }
    }

    if (tag === "img") {
      const src = absolute(base, imageSrc(attrs));
      const w = parseInt(attr(attrs, "width"), 10) || 0;
      const h = parseInt(attr(attrs, "height"), 10) || 0;
      const tiny = (w && w <= 2) || (h && h <= 2);
      const bulky = src.startsWith("data:") && src.length > 300;
      if (!src || tiny || bulky) {
        if (tiny) dropped.push("a tracking pixel");
        continue;
      }
      if (images.length >= LIMITS.images) continue;
      const alt = attr(attrs, "alt");
      const logoHint = /logo|brand|wordmark/i.test(`${src} ${alt} ${attr(attrs, "class")} ${attr(attrs, "id")}`);
      images.push({ url: src, alt, w, h, region: regions.at(-1) ?? "", context: heading, logoHint, background: false });
      flush();
      emit(`[${region()}img] ${src}${alt ? ` alt="${alt}"` : ""}${w && h ? ` ${w}x${h}` : ""}`);
      continue;
    }

    if (tag === "iframe" || tag === "embed") {
      const src = absolute(base, attr(attrs, "src"));
      if (!src) continue;
      flush();
      emit(`[${region()}embed] ${src}`);
      continue;
    }

    // <picture><source srcset>: usually the desktop cut, where the <img> after it
    // is the small fallback.
    if (tag === "source" && !attr(attrs, "type").startsWith("video")) {
      const set = attr(attrs, "srcset") || attr(attrs, "data-srcset");
      const src = set ? absolute(base, fromSrcset(set)) : "";
      if (src && !src.startsWith("data:") && images.length < LIMITS.images) {
        images.push({ url: src, alt: "", w: 0, h: 0, region: regions.at(-1) ?? "", context: heading, logoHint: /logo/i.test(src), background: false });
      }
      continue;
    }

    if (tag === "video" || (tag === "source" && attr(attrs, "type").startsWith("video"))) {
      const src = absolute(base, attr(attrs, "src"));
      if (!src) continue;
      flush();
      emit(`[${region()}video] ${src}${has(attrs, "autoplay") ? " autoplay" : ""}${has(attrs, "loop") ? " loop" : ""}`);
      continue;
    }

    if (tag === "input" || tag === "textarea") {
      const type = (attr(attrs, "type") || (tag === "textarea" ? "textarea" : "text")).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
      // A hamburger toggle and a "filter by" switch are controls, not questions.
      if (regions.length && ["checkbox", "radio"].includes(type)) continue;
      if (fields >= LIMITS.fields) continue;
      fields += 1;
      const name = attr(attrs, "name") || attr(attrs, "id");
      const ph = attr(attrs, "placeholder");
      const aria = attr(attrs, "aria-label");
      flush();
      emit(
        `[${region()}field] name=${name || "?"} type=${type}` +
          `${ph ? ` placeholder="${ph}"` : ""}${aria ? ` label="${aria}"` : ""}` +
          `${has(attrs, "required") ? " required" : ""}`,
      );
      continue;
    }

    if (tag === "a") {
      // Inline, so the text keeps flowing, but a short link is a button and
      // where it points is the one thing a landing page cannot afford to lose.
      const href = attr(attrs, "href");
      const tel = href.match(/^tel:(.+)/i)?.[1];
      if (tel) phones.add(decodeURIComponent(tel).trim());
      const mail = href.match(/^mailto:([^?]+)/i)?.[1];
      if (mail) emails.add(decodeURIComponent(mail).trim());
      if (href && links < LIMITS.links && !href.startsWith("#") && !/^javascript:/i.test(href)) {
        const slice = html.slice(m.index, m.index + 4000);
        const inner = slice.match(/^<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
        const anchor = decode(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        if (anchor && anchor.length <= 80) {
          links += 1;
          const to = absolute(base, href);
          emit(`[${region()}link] ${anchor} -> ${to}`);
          try {
            if (/^https?:/.test(to) && new URL(to).hostname === new URL(base).hostname) pages.push({ url: to, text: anchor });
          } catch {
            /* not a URL worth following */
          }
        }
      }
      continue;
    }

    if (VOID.has(tag)) continue;

    // An opening element whose text is a unit: close off whatever came before
    // it so the two do not run together, and remember what this one is.
    if (FLUSH.has(tag)) {
      flush();
      // div/section/article are structural, not semantic. They separate text
      // without claiming to describe it.
      label = ["div", "section", "article"].includes(tag) ? "" : tag;
    }
  }
  flush();

  // Wrapper elements repeat their children's text; consecutive identical lines
  // are that, not emphasis.
  const deduped = out.filter((l, i) => l !== out[i - 1]);

  return {
    outline: deduped.join("\n").slice(0, LIMITS.chars),
    title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim(),
    description: meta(html, "description"),
    ogTitle: meta(html, "og:title"),
    ogImage: absolute(base, meta(html, "og:image")),
    images,
    cssUrls,
    icons,
    pages,
    phones: [...phones].slice(0, 3),
    emails: [...emails].slice(0, 3),
    dropped: [...new Set(dropped)],
  };
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Any CSS colour a body background is realistically written as. */
function colour(value: string): string | null {
  const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) {
    const to = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`;
  }
  if (/\bwhite\b/i.test(value)) return "#ffffff";
  if (/\bblack\b/i.test(value)) return "#000000";
  return null;
}

/**
 * Drop the rules that only apply to someone who asked for a dark screen.
 *
 * A light page that ships a dark mode declares a dark background somewhere in
 * its stylesheet, and reading that as the page's own colour imports a white
 * page as a black one. Measured on basecamp.com, whose only dark background
 * lives inside one prefers-color-scheme block.
 */
function stripDark(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    const open = css.indexOf("{", at);
    if (open === -1) {
      out += css.slice(i);
      break;
    }
    const prelude = css.slice(at, open);
    if (!/prefers-color-scheme\s*:\s*dark/i.test(prelude)) {
      out += css.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    // Skip to this block's matching close brace.
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    out += css.slice(i, at);
    i = j;
  }
  return out.replace(/(?:^|[},])\s*(?:\.dark|\[data-theme=["']?dark["']?\])[^{}]*\{[^}]*\}/gi, " ");
}

/**
 * The theme, read from the stylesheet rather than guessed from the markup.
 *
 * Two things matter and only two. The accent, because a page in the wrong
 * colour undoes good copy. And whether the page is light or dark, because
 * importing a white page as a black one is the most obvious way for an import
 * to look like it failed, and the old code defaulted every page to dark
 * without ever looking.
 */
export function readTheme(rawCss: string): ThemeTokens {
  const css = stripDark(rawCss);
  const theme: ThemeTokens = {};

  // Every rule whose selector actually names the document root, rather than a
  // reset that happens to mention body among forty other elements.
  let bg: string | null = null;
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  let r: RegExpExecArray | null;
  while ((r = rules.exec(css)) !== null && !bg) {
    const selectors = r[1].split(",").map((x) => x.trim().toLowerCase());
    const names = selectors.filter((x) => x === "html" || x === "body" || x === ":root" || x === "html body");
    if (names.length === 0 || selectors.length > 4) continue;
    const decl = r[2].match(/background(?:-color)?\s*:\s*([^;]+)/i)?.[1];
    if (decl) bg = colour(decl);
  }
  if (!bg) {
    const v = rawCss.match(/--(?:background|bg|body-bg|color-bg)[\w-]*\s*:\s*([^;]+)/i)?.[1];
    if (v) bg = colour(v);
  }

  if (bg) {
    theme.mode = luminance(bg) > 0.5 ? "light" : "dark";
    theme.bg = bg;
  } else if (/color-scheme\s*:\s*[^;]*\bdark\b/i.test(css)) {
    theme.mode = "dark";
  } else {
    // Most of the web is a white page. Defaulting to dark is defaulting to wrong.
    theme.mode = "light";
  }

  // Accent: the most-used saturated colour that is not chrome.
  const counts: Record<string, number> = {};
  const re = /#([0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const hex = `#${m[1].toLowerCase()}`;
    const cr = parseInt(m[1].slice(0, 2), 16);
    const cg = parseInt(m[1].slice(2, 4), 16);
    const cb = parseInt(m[1].slice(4, 6), 16);
    const max = Math.max(cr, cg, cb);
    const min = Math.min(cr, cg, cb);
    if (max - min < 40) continue; // grey: chrome
    if (max < 40 || min > 220) continue; // near-black or near-white
    counts[hex] = (counts[hex] ?? 0) + 1;
  }
  const accent = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (accent) theme.accent = accent;

  return theme;
}
