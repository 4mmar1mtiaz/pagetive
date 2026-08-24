import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { composeBlocks, resolveForVisitor, type VariantRow } from "@/lib/compose";
import type { Block, PageSettings, ThemeTokens } from "@/lib/blocks";

/**
 * Everything needed to serve one published page, resolved once.
 *
 * Shared because a page is reachable two ways — by path (/p/slug) and by its
 * own hostname — and the two must behave identically. Duplicating the variant
 * resolution across both routes is how you end up with a page that personalises
 * on one URL and not the other, months before anyone notices.
 */

export type Served = {
  pageId: string;
  name: string;
  slug: string;
  blocks: Block[];
  theme: ThemeTokens;
  settings: PageSettings;
  variantId: string | null;
  track: boolean;
};

export async function servePage(args: {
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<Served | null> {
  const { slug, searchParams: sp } = args;

  const page = await prisma.page.findUnique({
    where: { slug },
    include: { variants: { where: { active: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!page) return null;

  const preview = sp.preview === "1";
  // A draft is unapproved copy. Never reachable on a real URL; the builder
  // still needs to see it, hence the explicit flag.
  if (page.status !== "live" && !preview) return null;

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) query.set(k, Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

  const jar = await cookies();
  const visitorId = jar.get("alp_vid")?.value ?? "anon";
  const forcedId = typeof sp.v === "string" ? sp.v : null;

  const variants = page.variants as unknown as VariantRow[];
  const variant = await resolveForVisitor({
    pageId: page.id,
    variants,
    params: query,
    visitorId,
    forcedId,
  });

  const settings = parseJson<PageSettings>(page.settings, {});

  return {
    pageId: page.id,
    name: page.name,
    slug: page.slug,
    blocks: composeBlocks(page.blocks, variant),
    theme: parseJson<ThemeTokens>(page.theme, {}),
    settings,
    variantId: variant?.id ?? null,
    // The heatmap viewer loads the page in an iframe; recording those loads
    // would corrupt the very numbers being looked at.
    track: settings.tracking !== false && sp.hm !== "1",
  };
}

/** Resolve a hostname to the page it serves. */
export async function slugForHost(hostname: string): Promise<string | null> {
  const clean = hostname.toLowerCase().split(":")[0];
  const domain = await prisma.domain.findUnique({
    where: { hostname: clean },
    include: { page: { select: { slug: true } } },
  });
  return domain?.page.slug ?? null;
}
