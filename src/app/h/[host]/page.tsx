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

/**
 * Why a hostname the platform is happily serving still shows nothing.
 *
 * A bare 404 here is the worst screen in the product. The DNS resolved, the
 * certificate is valid, the platform routed the request, and the answer is a
 * blank not-found with no way to tell which of four different things went
 * wrong. This says which, because the two causes look identical from outside
 * and neither is guessable: either the hostname belongs to the app and APP_URL
 * or APP_HOSTS does not say so, or it belongs to a page and was never attached
 * to one.
 */
function Unattached({ host, reason }: { host: string; reason: string }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="glass" style={{ padding: 28, maxWidth: 520 }}>
        <div className="chrome" style={{ fontSize: 18, fontWeight: 640, marginBottom: 10 }}>
          Nothing is published on {host}
        </div>
        <p className="sm" style={{ marginBottom: 14 }}>
          {reason}
        </p>
        <p className="sm" style={{ color: "var(--silver-faint)" }}>
          If this hostname is meant to be the app itself, set APP_URL to it, or add it to
          APP_HOSTS, and redeploy. If it is meant to serve a landing page, open that page in the
          workspace and attach the hostname in the domain panel.
        </p>
      </div>
    </main>
  );
}

export default async function HostedPage({ params, searchParams }: Props) {
  const { host } = await params;
  const sp = await searchParams;

  const slug = await slugForHost(host);
  if (!slug) {
    return (
      <Unattached
        host={host}
        reason="This hostname reached the app, so DNS and the certificate are fine. It is just not attached to any page, and the app does not recognise it as one of its own addresses either."
      />
    );
  }

  const served = await servePage({ slug, searchParams: sp });
  if (!served) {
    return (
      <Unattached
        host={host}
        reason={`This hostname is attached to the page "${slug}", but that page is still a draft. Publish it and this address starts working immediately.`}
      />
    );
  }

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
