import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { appHosts } from "@/lib/hosts";

/**
 * Three jobs, in this order, before anything renders.
 *
 * 1. Route by hostname. A page attached to a domain is served at that domain's
 *    root. The lookup itself cannot happen here — the edge runtime has no
 *    database — so an unrecognised host is rewritten to /h/{host} and resolved
 *    by a server component that does.
 *
 * 2. Issue the first-party visitor cookie. A Server Component cannot set a
 *    cookie during render, and setting it client-side would mean the very
 *    request that chooses this visitor's variant has no identity to be sticky
 *    against — so they would see a different offer on every load until
 *    JavaScript caught up.
 *
 * 3. Require a signed-in user for the workspace, and only the workspace.
 *    Published pages, the tracker and the lead endpoint must stay open to the
 *    whole internet: they are what a stranger who clicked an ad actually hits.
 *    Getting that boundary wrong in either direction is fatal — lock the pages
 *    and the product does nothing; leave the workspace open and anybody with
 *    the URL can read every lead in the database.
 *
 * Clerk is optional. With no keys configured the app runs as a single local
 * account, so self-hosting and development do not require an auth vendor.
 */

const COOKIE = "alp_vid";

/** Carries a just-minted visitor id into the render that mints it. */
export const FORWARD_HEADER = "x-alp-vid";

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/** Everything a visitor who clicked an ad has to be able to reach. */
const isPublic = createRouteMatcher([
  "/",            // the marketing page; signed-in users get the workspace here
  "/p/(.*)",
  "/h/(.*)",
  "/api/track",
  "/api/tracker",
  "/api/lead",
  "/api/health",
  "/api/webhooks/(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Crawler and social-scraper surface. These have no session and never will,
  // so leaving them behind auth means a shared link renders with no card and
  // robots.txt answers a redirect to sign-in.
  "/robots.txt",
  "/sitemap.xml",
  "/icon",
  "/opengraph-image",
  "/favicon.ico",
]);

function hostRewrite(request: NextRequest): URL | null {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  if (!host) return null;
  if (appHosts().includes(host)) return null;

  const { pathname } = request.nextUrl;
  // The app's own surfaces stay reachable on every host — otherwise a customer
  // domain would swallow the endpoint its own page posts leads to.
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/h/") ||
    pathname.startsWith("/p/") ||
    pathname === "/favicon.ico"
  ) {
    return null;
  }

  const url = request.nextUrl.clone();
  url.pathname = `/h/${host}`;
  return url;
}

function base(request: NextRequest): { res: NextResponse; hosted: boolean } {
  const rewrite = hostRewrite(request);
  const existing = request.cookies.get(COOKIE)?.value;
  const visitorId = existing ?? crypto.randomUUID().replace(/-/g, "");

  // A brand new visitor has no cookie on the request that renders their first
  // page, so without this the first view is assigned a variant that is then
  // thrown away: the cookie only arrives with the response, and their next
  // request picks a different one. That first view is also the one credited
  // with the traffic source, so getting it wrong scrambles attribution as well
  // as flickering the offer. Forwarding the new id as a request header lets the
  // very first render use the identity the response is about to hand out.
  const headers = new Headers(request.headers);
  if (!existing) headers.set(FORWARD_HEADER, visitorId);

  const init = { request: { headers } };
  const res = rewrite ? NextResponse.rewrite(rewrite, init) : NextResponse.next(init);

  if (!existing) {
    res.cookies.set(COOKIE, visitorId, {
      httpOnly: false, // the tracker reads it, so it cannot be httpOnly
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  return { res, hosted: Boolean(rewrite) };
}

const withClerk = clerkMiddleware(async (auth, request) => {
  const { res, hosted } = base(request);
  // A request that resolved to a customer hostname is, by definition, someone
  // else's landing page. Never gate it.
  if (hosted || isPublic(request)) return res;
  await auth.protect();
  return res;
});

export function proxy(request: NextRequest) {
  if (clerkConfigured) return withClerk(request, {} as never);
  return base(request).res;
}

export const config = {
  // Everything except static assets: host routing has to see the root path, and
  // the visitor cookie has to exist before the first render on any surface.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
