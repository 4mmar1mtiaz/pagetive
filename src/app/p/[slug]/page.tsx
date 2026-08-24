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

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const page = await prisma.page.findUnique({ where: { slug }, select: { name: true, goal: true } });
  return { title: page?.name ?? "Landing page", description: page?.goal ?? "" };
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
