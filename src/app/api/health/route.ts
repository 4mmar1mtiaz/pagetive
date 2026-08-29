import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/llm";
import { appUrl, wildcardRoot } from "@/lib/hosts";
import { storageReady } from "@/lib/storage";
import { platformConfigured } from "@/lib/platform";
import { currentSession } from "@/lib/account";

/**
 * Why a deployment is broken, in one request.
 *
 * Next strips Server Component error messages in production, so a failed page
 * can only ever say "an error occurred" plus a digest — enough to know
 * something is wrong and never enough to know what. A route handler owns its
 * own response, so every check below reports the real error text.
 *
 * Reports whether each secret is present, never its value, so this is safe to
 * open on a public URL and paste into a chat.
 */

export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; detail: string };

function describeUrl(raw: string | undefined): string {
  if (!raw) return "not set";
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"} db=${u.pathname.slice(1) || "?"}`;
  } catch {
    return "set, but not parseable as a URL";
  }
}

/**
 * Who is allowed to see the detail.
 *
 * The point of this endpoint is that a broken deployment can explain itself,
 * and that only works if it is reachable before anyone can sign in. But the
 * detail is a map of the stack — the database host, its region, which vendors
 * are wired — and handing that to the whole internet is a finding, not a
 * feature. Signed in, or holding the shared secret, gets the full report;
 * everyone else gets the one bit that matters, which is whether it is up.
 */
async function maySeeDetail(req: Request): Promise<boolean> {
  const secret = process.env.HEALTH_TOKEN?.trim();
  if (secret) {
    const url = new URL(req.url);
    const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (url.searchParams.get("token") === secret || header === secret) return true;
  }
  try {
    const session = await currentSession();
    return !session.anonymous;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add("DATABASE_URL", Boolean(process.env.DATABASE_URL), describeUrl(process.env.DATABASE_URL));
  add(
    "DIRECT_URL",
    Boolean(process.env.DIRECT_URL),
    process.env.DIRECT_URL
      ? describeUrl(process.env.DIRECT_URL)
      : "NOT SET — the schema declares directUrl and the client will not start without it, even though only migrations use it",
  );
  add("ANTHROPIC_API_KEY", hasApiKey(), hasApiKey() ? "present" : "missing — the chat cannot run");
  // The effective value, not the raw variable: on a platform that publishes its
  // own hostname a localhost APP_URL is overridden rather than obeyed, and a
  // check that reported the variable would call a working deployment broken.
  const effectiveAppUrl = appUrl();
  add(
    "APP_URL",
    !effectiveAppUrl.includes("localhost"),
    process.env.APP_URL === effectiveAppUrl || !process.env.APP_URL
      ? effectiveAppUrl
      : `${effectiveAppUrl} — from the platform; APP_URL itself is ${process.env.APP_URL}`,
  );
  // Media is optional: pages work without it, they just cannot carry images or
  // video. Reported as a check so a failed upload has an answer on this page
  // rather than only in a browser console.
  add(
    "Media storage",
    storageReady(),
    storageReady()
      ? "Supabase Storage configured"
      : "not set — SUPABASE_URL and SUPABASE_SECRET_KEY are needed before images or video can be uploaded",
  );

  // Not a failure when unset: a wildcard root, or a proxy that already answers
  // on every hostname, are both complete answers. It is reported because a
  // customer domain that 404s with valid DNS is otherwise unexplainable.
  const wildcard = wildcardRoot();
  add(
    "Custom domain registration",
    true,
    platformConfigured()
      ? "automatic — a hostname attached to a page is registered with the host in the same request"
      : wildcard
        ? `manual for hostnames outside *.${wildcard} — set VERCEL_API_TOKEN and VERCEL_PROJECT_ID to automate them`
        : "manual — set VERCEL_API_TOKEN and VERCEL_PROJECT_ID, or a WILDCARD_ROOT, or customer hostnames will 404 with no certificate",
  );

  const clerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  add(
    "Clerk",
    true,
    clerk
      ? "configured — the workspace requires sign-in"
      : "NOT configured — the workspace is OPEN to anyone with the URL. Fine locally, not on a public host.",
  );
  add(
    "WILDCARD_ROOT",
    true,
    wildcardRoot() ? `*.${wildcardRoot()}` : "not set — pages are reachable on /p/ paths only",
  );
  add(
    "PLAN_WEBHOOK_SECRET",
    true,
    process.env.PLAN_WEBHOOK_SECRET ? "present" : "not set — the upgrade webhook is disabled",
  );

  let dbUp = false;
  try {
    await prisma.$queryRaw`select 1`;
    dbUp = true;
    add("database connect", true, "reachable and authenticated");
  } catch (err) {
    add("database connect", false, (err as Error).message);
  }

  if (dbUp) {
    for (const table of ["Account", "Page", "Variant", "Event", "Lead", "Domain", "Usage"]) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `select count(*)::bigint as n from "${table}"`,
        );
        add(`table ${table}`, true, `${rows[0]?.n ?? 0} rows`);
      } catch (err) {
        add(`table ${table}`, false, `${(err as Error).message} — run 'prisma migrate deploy'`);
      }
    }

    // Parallel reads are what the report does and what a small pool kills.
    try {
      await Promise.all(Array.from({ length: 8 }, () => prisma.page.count()));
      add("parallel reads", true, "8 concurrent queries completed");
    } catch (err) {
      add(
        "parallel reads",
        false,
        `${(err as Error).message} — this is what makes the report 500 while simpler pages still work`,
      );
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const status = failed.length === 0 ? 200 : 503;

  if (!(await maySeeDetail(req))) {
    // Names of failing checks, never their detail. Enough for an uptime
    // monitor and for someone to say "the database check is red" out loud,
    // without publishing the hostname it failed to reach.
    return NextResponse.json(
      {
        ok: failed.length === 0,
        summary:
          failed.length === 0
            ? "Everything this deployment needs is present and working."
            : `${failed.length} check${failed.length === 1 ? "" : "s"} failing: ${failed.map((c) => c.name).join(", ")}`,
        detail: "Sign in, or pass the HEALTH_TOKEN, to see the full report.",
      },
      { status },
    );
  }

  return NextResponse.json(
    {
      ok: failed.length === 0,
      summary:
        failed.length === 0
          ? "Everything this deployment needs is present and working."
          : `${failed.length} check${failed.length === 1 ? "" : "s"} failing: ${failed.map((c) => c.name).join(", ")}`,
      checks,
    },
    { status },
  );
}
