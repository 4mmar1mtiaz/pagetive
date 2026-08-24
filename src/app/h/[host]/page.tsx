import { notFound } from "next/navigation";
import { LP_CSS } from "@/styles/lp-css";
import { servePage, slugForHost } from "@/lib/serve";
import { LandingPage } from "@/components/lp/Blocks";

// A page reached on its own hostname. Same renderer, same variant resolution as
// the /p/{slug} route — only the way the page was located differs.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ host: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const { host } = await params;
  const slug = await slugForHost(host);
  if (!slug) return { title: "Not found" };
  const served = await servePage({ slug, searchParams: {} });
  return { title: served?.name ?? "Landing page" };
}

export default async function HostedPage({ params, searchParams }: Props) {
  const { host } = await params;
  const sp = await searchParams;

  const slug = await slugForHost(host);
  if (!slug) notFound();

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
