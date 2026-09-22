import { prisma } from "@/lib/db";
import { storageReady, uploadAsset } from "@/lib/storage";
import { IMAGE_TYPES } from "@/lib/media-types";
import type { ScrapedImage } from "@/lib/scrape";

/**
 * Turning the pictures on somebody's website into pictures a page can use.
 *
 * The scraper finds every image a page mentions. Most of them are no use: icons,
 * sprites, social badges, tracking pixels, the same photo at four sizes. And the
 * markup lies about the rest, because width and height are usually missing or
 * set by CSS. So every candidate is downloaded and measured from its own bytes
 * before anything decides where it goes. A 300px thumbnail stretched across a
 * hero is the fastest way to make an imported brand look worse than their site.
 *
 * What survives is copied into our own storage, because a page that hotlinks
 * their files breaks the day they redesign, and some hosts refuse hotlinks
 * outright. It is saved as an Asset with a description, so it also shows up in
 * the user's media library and can be placed again later.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** Bigger than any sensible web photo. Anything over this is a mistake to copy. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATES = 24;
const MAX_KEPT = 12;

export type ImageRole = "logo" | "hero" | "photo" | "thumbnail";

export type SiteImage = {
  /** Our copy when storage is configured, their URL when it is not. */
  url: string;
  source: string;
  role: ImageRole;
  alt: string;
  w: number;
  h: number;
  orientation: "landscape" | "portrait" | "square";
  /** Wide and sharp enough to sit behind a full-width section. */
  backgroundOk: boolean;
  /** The heading it sat under on their site. */
  context: string;
};

/** Filenames that are always chrome, whatever size they come in. */
const JUNK =
  /sprite|pixel|spacer|blank\.|loader|spinner|badge|avatar-default|gravatar|emoji|flag[-_]|arrow|chevron|caret|icon[-_s]|\/icons?\/|facebook|twitter|x-logo|instagram|linkedin|youtube|tiktok|pinterest|whatsapp|google-play|app-store|trustpilot-stars|payment|visa|mastercard|paypal|amex|captcha|doubleclick|analytics|pixel\.gif/i;

/**
 * The phone-sized cut of a picture the page also ships at desktop size. The
 * desktop one is always the one worth keeping, and the pair are otherwise two
 * slots in the list spent on one photo.
 */
const MOBILE = /(?:^|[-_/])(?:mobile|mob|mbl)(?=[-_./]|\d|$)/i;

/** Width and height from the file header, for every format the renderer shows. */
export function dimensions(buf: Uint8Array, mime: string): { w: number; h: number } | null {
  const u16be = (o: number) => (buf[o] << 8) | buf[o + 1];
  const u16le = (o: number) => buf[o] | (buf[o + 1] << 8);
  const u24le = (o: number) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
  const u32be = (o: number) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;

  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length > 24) return { w: u32be(16), h: u32be(20) };
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf.length > 10) return { w: u16le(6), h: u16le(8) };
  // JPEG: walk the markers to the first start-of-frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o += 1;
        continue;
      }
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: u16be(o + 7), h: u16be(o + 5) };
      }
      o += 2 + u16be(o + 2);
    }
    return null;
  }
  // WebP
  if (buf[0] === 0x52 && buf[8] === 0x57 && buf.length > 30) {
    const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (chunk === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.slice(21, 25);
      return { w: 1 + (((b[1] & 0x3f) << 8) | b[0]), h: 1 + (((b[3] & 0xf) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { w: 1 + u24le(24), h: 1 + u24le(27) };
  }
  // SVG: scalable, so the declared size is only a proportion.
  if (mime === "image/svg+xml") {
    const head = new TextDecoder().decode(buf.slice(0, 4000));
    const vb = head.match(/viewBox=["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (vb) return { w: Math.round(parseFloat(vb[1])), h: Math.round(parseFloat(vb[2])) };
    const w = head.match(/<svg[^>]*\bwidth=["']([\d.]+)/i)?.[1];
    const h = head.match(/<svg[^>]*\bheight=["']([\d.]+)/i)?.[1];
    if (w && h) return { w: Math.round(parseFloat(w)), h: Math.round(parseFloat(h)) };
  }
  return null;
}

/** AVIF and friends measure fine in a browser but not here. Trust the markup for those. */
function sniff(buf: Uint8Array, header: string): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[8] === 0x57) return "image/webp";
  const type = header.split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml" || new TextDecoder().decode(buf.slice(0, 300)).includes("<svg")) return "image/svg+xml";
  return type;
}

type Fetched = { candidate: ScrapedImage; bytes: Uint8Array; mime: string; w: number; h: number };

async function download(c: ScrapedImage): Promise<Fetched | null> {
  try {
    const res = await fetch(c.url, {
      headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    const mime = sniff(bytes, res.headers.get("content-type") ?? "");
    if (!IMAGE_TYPES.includes(mime)) return null;
    const size = dimensions(bytes, mime) ?? (c.w && c.h ? { w: c.w, h: c.h } : null);
    if (!size || !size.w || !size.h) return null;
    return { candidate: c, bytes, mime, ...size };
  } catch {
    return null;
  }
}

/** Two URLs for the same photo at different sizes are one photo. */
function key(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname)
      .toLowerCase()
      .replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, "") // WordPress thumbnails
      .replace(/@\dx(?=\.\w+$)/, "")
      // The dark-mode twin of a light picture is the same picture.
      .replace(/([-_])dark(?=[-_.])/g, "$1light");
  } catch {
    return url;
  }
}

function classify(f: Fetched, ogImage: string): ImageRole | null {
  const { w, h, candidate: c, mime } = f;
  const ratio = w / h;
  const logoShaped = ratio >= 1.4 && ratio <= 12 && h <= 400;
  if (c.logoHint && (logoShaped || mime === "image/svg+xml" || (ratio > 0.8 && ratio < 1.25 && w <= 600))) return "logo";
  // Named a logo but not shaped like one: a share card with the logo on it,
  // which is no use as a photograph.
  if (/logo/i.test(`${c.url} ${c.alt}`)) return null;
  // Footer and sidebar pictures are payment marks, badges and partner seals.
  if (c.region === "footer" || c.region === "aside") return null;
  if (c.region === "nav") return null;
  if (mime === "image/svg+xml") return null; // an illustration at best, an icon usually
  if (w < 120 || h < 120) return null;
  if (ratio > 5 || ratio < 0.2) return null; // dividers, ribbons, skyscrapers
  if (c.url === ogImage || c.background) return w >= 1000 ? "hero" : "photo";
  if (w >= 1200 && ratio >= 1.3) return "hero";
  if (w >= 400 && h >= 250) return "photo";
  return "thumbnail";
}

/**
 * Keep an existing copy of a picture rather than storing it twice.
 *
 * Reading the same site twice (read_brand, then an import of the same domain)
 * would otherwise fill the library with duplicates. The source URL is kept as
 * the asset's name, which is what makes it findable again.
 */
async function rehost(accountId: string, host: string, img: Fetched, role: ImageRole): Promise<string> {
  const source = img.candidate.url;
  const existing = await prisma.asset.findFirst({ where: { ownerId: accountId, name: source }, select: { url: true } });
  if (existing) return existing.url;

  const ext = img.mime.split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
  const base = source.split("?")[0].split("/").pop()?.replace(/\.\w+$/, "") || role;
  const uploaded = await uploadAsset({
    accountId,
    file: new Blob([img.bytes as BlobPart], { type: img.mime }),
    filename: `${host}-${base}.${ext}`,
    mime: img.mime,
  });
  const about = [
    `From ${host}: their ${role === "hero" ? "hero / banner image" : role}`,
    img.candidate.alt ? `"${img.candidate.alt}"` : "",
    img.candidate.context ? `shown under "${img.candidate.context}"` : "",
    `${img.w}x${img.h}`,
  ]
    .filter(Boolean)
    .join(", ");
  await prisma.asset.create({
    data: {
      ownerId: accountId,
      kind: "image",
      url: uploaded.url,
      path: uploaded.path,
      mime: img.mime,
      bytes: img.bytes.length,
      name: source,
      description: about,
    },
  });
  return uploaded.url;
}

/**
 * The pictures worth putting on a page, measured, sorted and (when storage is
 * set up and there is an account to own them) copied into our storage.
 */
export async function collectSiteImages(args: {
  images: ScrapedImage[];
  icons: string[];
  ogImage: string;
  host: string;
  accountId?: string;
}): Promise<SiteImage[]> {
  const seen = new Set<string>();
  const candidates: ScrapedImage[] = [];
  const push = (c: ScrapedImage) => {
    if (!/^https?:/i.test(c.url) || JUNK.test(c.url) || MOBILE.test(c.url)) return;
    const k = key(c.url);
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push(c);
  };

  // The share image is the one they chose to represent the site, so it goes first.
  if (args.ogImage) {
    push({ url: args.ogImage, alt: "", w: 0, h: 0, region: "", context: "", logoHint: /logo/i.test(args.ogImage), background: false });
  }
  // Logos next, wherever they sit, so the cap never cuts the logo off.
  for (const c of args.images) if (c.logoHint) push(c);
  for (const c of args.images) push(c);

  const fetched = (await Promise.all(candidates.slice(0, MAX_CANDIDATES).map(download))).filter(
    (f): f is Fetched => f !== null,
  );

  const picked: { f: Fetched; role: ImageRole }[] = [];
  let logo = false;
  for (const f of fetched) {
    const role = classify(f, args.ogImage);
    if (!role) continue;
    if (role === "logo") {
      if (logo) continue; // one logo; the rest are partner and client marks
      logo = true;
    }
    picked.push({ f, role });
  }

  // No logo in the markup: a large touch icon is a square mark, better than nothing.
  if (!logo && args.icons.length) {
    const icons = await Promise.all(
      args.icons.slice(0, 3).map((u) =>
        download({ url: u, alt: "", w: 0, h: 0, region: "", context: "", logoHint: true, background: false }),
      ),
    );
    const best = icons.filter((i): i is Fetched => i !== null && i.w >= 120).sort((a, b) => b.w - a.w)[0];
    if (best) picked.unshift({ f: best, role: "logo" });
  }

  // Heroes and big photos before thumbnails, but keep page order within each.
  const rank: Record<ImageRole, number> = { logo: 0, hero: 1, photo: 2, thumbnail: 3 };
  const kept = picked
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.i - b.i)
    .slice(0, MAX_KEPT);

  const store = Boolean(args.accountId) && storageReady();
  return Promise.all(
    kept.map(async ({ f, role }) => {
      let url = f.candidate.url;
      if (store) {
        try {
          url = await rehost(args.accountId!, args.host, f, role);
        } catch {
          /* their URL still works today; a failed copy is not a failed read */
        }
      }
      const ratio = f.w / f.h;
      return {
        url,
        source: f.candidate.url,
        role,
        alt: f.candidate.alt,
        w: f.w,
        h: f.h,
        orientation: ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square",
        backgroundOk: role !== "logo" && f.mime !== "image/svg+xml" && f.w >= 1200 && ratio >= 1.2,
        context: f.candidate.context,
      } satisfies SiteImage;
    }),
  );
}

/**
 * Swap every picture URL in a set of blocks for our stored copy.
 *
 * For the importer, whose model places their images straight from the page it
 * read. Any URL it used that we did not copy is left alone.
 */
export function swapUrls<T>(value: T, map: Map<string, string>): T {
  if (map.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
