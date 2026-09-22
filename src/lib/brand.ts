import type { ThemeTokens } from "@/lib/blocks";
import { readPage, type Scraped } from "@/lib/scrape";
import { collectSiteImages, type SiteImage } from "@/lib/site-images";

/**
 * Read a brand off its own website.
 *
 * A generated page that ignores the customer's existing look is the fastest way
 * to make good copy feel cheap, and asking somebody to describe their brand in
 * a chat box gets you "modern and clean" every time. Their live site already
 * contains the answer, so this reads it: the palette they actually use, whether
 * they run light or dark, their typeface, and enough of a written impression
 * for the generator to match tone rather than guess it.
 *
 * Everything here is a heuristic on other people's markup, so every field is
 * optional and a miss degrades to the default theme rather than a broken page.
 */

type Swatch = { hex: string; count: number; sat: number; light: number };

function hexOf(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** HSL-ish saturation and lightness, 0-1, without a colour library. */
function describe(r: number, g: number, b: number): { sat: number; light: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const light = (max + min) / 2;
  const delta = max - min;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1) || 1);
  return { sat: Math.min(1, sat), light };
}

function collectColours(css: string): Swatch[] {
  const counts = new Map<string, number>();

  const hex6 = /#([0-9a-f]{6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hex6.exec(css)) !== null) {
    const hex = `#${m[1].toLowerCase()}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const hex3 = /#([0-9a-f]{3})\b/gi;
  while ((m = hex3.exec(css)) !== null) {
    const [a, b, c] = m[1].toLowerCase();
    const hex = `#${a}${a}${b}${b}${c}${c}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const rgb = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi;
  while ((m = rgb.exec(css)) !== null) {
    const hex = hexOf(Number(m[1]), Number(m[2]), Number(m[3]));
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([hex, count]) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return { hex, count, ...describe(r, g, b) };
    })
    .sort((a, b) => b.count - a.count);
}

function fontsIn(html: string): string[] {
  const found = new Set<string>();

  // Google Fonts links name the family in the query string, which is more
  // reliable than parsing a font stack.
  const googleRe = /fonts\.googleapis\.com\/css2?\?([^"']+)/gi;
  let m: RegExpExecArray | null;
  while ((m = googleRe.exec(html)) !== null) {
    for (const fam of m[1].matchAll(/family=([^&:]+)/g)) {
      found.add(decodeURIComponent(fam[1]).replace(/\+/g, " "));
    }
  }

  const stackRe = /font-family\s*:\s*([^;}"']+)/gi;
  while ((m = stackRe.exec(html)) !== null) {
    const first = m[1].split(",")[0].trim().replace(/^["']|["']$/g, "");
    // Skip generic families and CSS variables; they say nothing about a brand.
    if (!first || first.startsWith("var(") || first.length > 40) continue;
    if (/^(inherit|initial|sans-serif|serif|monospace|system-ui|ui-sans-serif|-apple-system)$/i.test(first)) continue;
    found.add(first);
  }

  return [...found].slice(0, 6);
}

function meta(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].trim();
  }
  return "";
}

export type Brand = {
  url: string;
  siteName: string;
  description: string;
  theme: ThemeTokens;
  /** Written impression, handed to the generator alongside the facts. */
  brief: string;
  palette: string[];
  fonts: string[];
  /** Only when asked for with `site`: what the business says, and its pictures. */
  details?: string;
  phones?: string[];
  emails?: string[];
  images?: SiteImage[];
};

/** Pages beyond the home page that usually say what a business does and show it. */
const WORTH_READING = /about|service|what-we-do|our-work|work|portfolio|gallery|projects|team|products?|solutions|menu/i;

/** Selling copy only: headings, paragraphs, list items. Chrome and markup lines are dropped. */
function copyOf(page: Scraped, max: number): string {
  return page.outline
    .split("\n")
    .filter((l) => /^\[(h\d|p|li|blockquote|text|dt|dd|td|figcaption|summary|button)\]/.test(l))
    .join("\n")
    .slice(0, max);
}

async function fetchHtml(url: string): Promise<{ html: string; url: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return { html: await res.text(), url: res.url || url };
  } catch {
    return null;
  }
}

/**
 * @param site Also read what the business says about itself and collect its
 *   pictures, from the home page and up to two inner pages. `accountId` owns the
 *   stored copies of those pictures; without it they are linked, not copied.
 */
export async function readBrand(rawUrl: string, site?: { accountId?: string }): Promise<Brand> {
  let target: URL;
  try {
    target = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error(`"${rawUrl}" is not a URL.`);
  }

  const res = await fetch(target.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  }).catch((err: Error) => {
    throw new Error(`Could not reach ${target.hostname}: ${err.message}`);
  });
  if (!res.ok) throw new Error(`${target.hostname} returned HTTP ${res.status}.`);

  const html = await res.text();

  // Same-origin stylesheets, because most brands keep their palette there
  // rather than inline. Capped at three so one slow site cannot stall a build.
  const sheets = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((href) => !href.startsWith("http") || href.includes(target.hostname))
    .slice(0, 3);

  let css = html;
  for (const href of sheets) {
    try {
      const sheetUrl = new URL(href, target).toString();
      const sheet = await fetch(sheetUrl, { signal: AbortSignal.timeout(8000) });
      if (sheet.ok) css += `\n${(await sheet.text()).slice(0, 300000)}`;
    } catch {
      /* a missing stylesheet is not a failure */
    }
  }

  const swatches = collectColours(css);

  // Brand colour: the most-used thing that is neither grey nor near-black or
  // near-white. Those are chrome; a brand is the saturated one.
  const brandish = swatches.filter((s) => s.sat > 0.25 && s.light > 0.18 && s.light < 0.86);
  const accent = brandish[0]?.hex;
  const secondary = brandish.find((s) => s.hex !== accent && Math.abs(s.light - (brandish[0]?.light ?? 0)) > 0.1)?.hex;

  // Light or dark: judged from the darkest and lightest high-frequency
  // neutrals, which are almost always the page background and its text.
  const neutrals = swatches.filter((s) => s.sat <= 0.25).slice(0, 12);
  const darkNeutral = neutrals.filter((n) => n.light < 0.3).sort((a, b) => b.count - a.count)[0];
  const lightNeutral = neutrals.filter((n) => n.light > 0.85).sort((a, b) => b.count - a.count)[0];
  const isDark = (darkNeutral?.count ?? 0) > (lightNeutral?.count ?? 0) * 1.4;

  const fonts = fontsIn(html);
  const siteName = meta(html, "og:site_name") || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const description = meta(html, "description") || meta(html, "og:description");

  const theme: ThemeTokens = {
    mode: isDark ? "dark" : "light",
    ...(accent ? { accent } : {}),
    ...(secondary ? { accentSoft: secondary } : {}),
    ...(isDark
      ? {
          bg: darkNeutral?.hex ?? "#0a0c10",
          surface: "#141821",
          text: "#f2f5f9",
          muted: "#9aa5b3",
        }
      : {
          bg: lightNeutral?.hex ?? "#ffffff",
          surface: "#f4f6f9",
          text: "#10141a",
          muted: "#5a6472",
        }),
    ...(fonts[0] ? { font: fonts[0] } : {}),
  };

  const brief = [
    `Brand read from ${target.hostname}.`,
    siteName ? `Site name: ${siteName}.` : "",
    description ? `They describe themselves as: ${description}` : "",
    `Their site runs ${isDark ? "dark" : "light"}.`,
    accent ? `Their brand colour is ${accent}${secondary ? ` with ${secondary} alongside it` : ""}.` : "No clear brand colour found; a neutral palette was used.",
    fonts.length ? `Typefaces in use: ${fonts.join(", ")}.` : "No distinctive typeface found.",
    "Match this palette and register. Do not describe the colours in the copy.",
  ]
    .filter(Boolean)
    .join(" ");

  let extra: Pick<Brand, "details" | "phones" | "emails" | "images"> = {};
  if (site) {
    const home = readPage(html, res.url || target.toString());
    const inner = [
      ...new Map(
        home.pages
          .filter((p) => WORTH_READING.test(`${p.text} ${new URL(p.url).pathname}`))
          .map((p) => [p.url.split("#")[0].replace(/\/$/, ""), p] as const),
      ).values(),
    ]
      .filter((p) => p.url.replace(/\/$/, "") !== (res.url || target.toString()).replace(/\/$/, ""))
      .slice(0, 2);
    const others = (await Promise.all(inner.map((p) => fetchHtml(p.url))))
      .filter((r): r is { html: string; url: string } => r !== null)
      .map((r) => ({ url: r.url, page: readPage(r.html, r.url) }));

    const images = await collectSiteImages({
      images: [...home.images, ...others.flatMap((o) => o.page.images)],
      icons: home.icons,
      ogImage: home.ogImage,
      host: target.hostname.replace(/^www\./, ""),
      accountId: site.accountId,
    });

    extra = {
      details: [
        `Home page (${res.url || target.toString()}):\n${copyOf(home, 5000)}`,
        ...others.map((o) => `${o.url}:\n${copyOf(o.page, 2500)}`),
      ].join("\n\n"),
      phones: [...new Set([home, ...others.map((o) => o.page)].flatMap((p) => p.phones))].slice(0, 3),
      emails: [...new Set([home, ...others.map((o) => o.page)].flatMap((p) => p.emails))].slice(0, 3),
      images,
    };
  }

  return {
    ...extra,
    url: target.toString(),
    siteName,
    description,
    theme,
    brief,
    palette: brandish.slice(0, 6).map((s) => s.hex),
    fonts,
  };
}
