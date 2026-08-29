import { notFound } from "next/navigation";
import { LP_CSS } from "@/styles/lp-css";
import { prisma } from "@/lib/db";
import { servePage } from "@/lib/serve";
import { LandingPage } from "@/components/lp/Blocks";

// Published landing pages are always rendered fresh: which variant a visitor
// sees is decided per request, so a cached page would serve one person's
// personalisation to everybody.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * A published page's own card, not the product's.
 *
 * A landing page is made to be shared into the exact places that render link
 * previews, so inheriting the app's title and image would put the builder's
 * branding on the customer's ad destination. The title is also set flat rather
 * than through the layout's template, for the same reason: nobody's landing
 * page should say "· Pagetive" after its headline.
 */
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const page = await prisma.page.findUnique({
    where: { slug },
    select: { name: true, goal: true, blocks: true },
  });
  if (!page) return { title: "Landing page" };

  const title = page.name || "Landing page";
  const description = page.goal || "";

  // The hero image, if the page has one, is the right social card: it is what
  // the visitor sees a second later.
  let image: string | undefined;
  try {
    const blocks = JSON.parse(page.blocks) as { imageUrl?: string; mediaUrl?: string; mediaKind?: string }[];
    const withImage = blocks.find((b) => b.imageUrl || (b.mediaUrl && b.mediaKind !== "video"));
    image = withImage?.imageUrl ?? withImage?.mediaUrl;
  } catch {
    image = undefined;
  }

  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? ("summary_large_image" as const) : ("summary" as const),
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function PublicPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const served = await servePage({ slug, searchParams: sp });
  if (!served) notFound();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />
      <LandingPage
        blocks={served.blocks}
        theme={served.theme}
        ctx={{ pageId: served.pageId, variantId: served.variantId, settings: served.settings }}
      />
      {served.track ? (
        <script src="/api/tracker" data-page={served.pageId} data-variant={served.variantId ?? ""} defer />
      ) : null}
    </>
  );
}
