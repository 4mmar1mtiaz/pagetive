import slugify from "slugify";
import { prisma } from "@/lib/db";
import { toJson } from "@/lib/json";

/** Slugs are the public URL and never change once a page is live, so collisions
 *  are resolved at creation time rather than by rewriting an existing one. */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name || "page", { lower: true, strict: true }).slice(0, 48) || "page";
  let candidate = base;
  let n = 1;
  while (await prisma.page.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/** Every page gets a control variant at creation. The bandit needs a baseline
 *  to compare against, and a page with no variants has nothing to attribute
 *  its own traffic to. */
export async function ensureControl(pageId: string): Promise<string> {
  const existing = await prisma.variant.findFirst({ where: { pageId, isControl: true } });
  if (existing) return existing.id;
  const created = await prisma.variant.create({
    data: {
      pageId,
      name: "Control",
      angle: "original",
      isControl: true,
      overrides: toJson({}),
      match: toJson({}),
    },
  });
  return created.id;
}
