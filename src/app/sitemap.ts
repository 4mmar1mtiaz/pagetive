import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/hosts";

/**
 * Every published page, and nothing else.
 *
 * Drafts are excluded deliberately: they are reachable only with ?preview=1
 * and listing them would hand crawlers a URL that answers 404 to everyone
 * else. The list is read at request time rather than built, because a page
 * goes live by flipping a flag and a sitemap that needed a deploy to notice
 * would always be behind.
 */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl().replace(/\/+$/, "");

  const pages = await prisma.page
    .findMany({
      where: { status: "live" },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    })
    .catch(() => []);

  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    ...pages.map((p) => ({
      url: `${base}/p/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
