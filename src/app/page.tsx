import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/account";
import { servePage } from "@/lib/serve";
import { LP_CSS } from "@/styles/lp-css";
import { LandingPage } from "@/components/lp/Blocks";
import { Workspace } from "@/components/Workspace";

/**
 * One route, two audiences.
 *
 * Signed in, this is the workspace. Signed out, it is the product's own landing
 * page — which is itself a page built and served by this product, so it gets
 * variants, a funnel and heatmaps like any customer page. If the marketing page
 * ever stops converting, the tool that is supposed to fix that is the one
 * serving it.
 *
 * The route is public, which is why `currentSession` had to learn to return an
 * anonymous session rather than falling back to the single-user local account.
 */
export const dynamic = "force-dynamic";

/**
 * The page served at "/" to signed-out visitors, if any.
 *
 * Blank is a real answer, and the common one once the marketing site has its
 * own hostname: the app's own domain is then a front door for people who
 * already have an account or are about to make one, and it should say so in
 * one redirect rather than showing a placeholder about a page that is
 * deliberately somewhere else.
 */
const MARKETING_SLUG = process.env.MARKETING_SLUG?.trim() || "";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  const clerkOn = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );

  if (!session.anonymous) return <Workspace clerkOn={clerkOn} />;

  // No marketing page configured: this domain is the app, so the front door is
  // the way in. Sign-in rather than sign-up because the widget links to the
  // other one and a returning user is the likelier visitor to a bare root.
  if (!MARKETING_SLUG) redirect("/sign-in");

  const sp = await searchParams;
  const served = await servePage({ slug: MARKETING_SLUG, searchParams: sp });
  const githubUrl = process.env.GITHUB_URL?.trim() || null;

  // Configured but not servable — wrong slug, or still a draft. Same answer as
  // no page at all: send them somewhere that works instead of explaining a
  // configuration problem to a stranger.
  if (!served) redirect("/sign-in");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LP_CSS }} />
      {/* The two things the generated page cannot carry: a way back in for
          somebody who already has an account, and a link to the source. Both
          belong to the app rather than to the page's content, so they live
          here and survive any regeneration of the page itself. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 10,
          padding: "14px 18px",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        {githubUrl ? (
          <a
            className="btn sm ghost"
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            title="Read the source"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Source
          </a>
        ) : null}
        <Link className="btn sm ghost" href="/sign-in">
          Sign in
        </Link>
        <Link className="btn sm primary" href="/sign-up">
          Start free
        </Link>
      </div>

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
