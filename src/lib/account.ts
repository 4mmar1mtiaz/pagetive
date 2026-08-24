import { prisma } from "@/lib/db";
import { DEFAULT_PLAN, entitlements, type Entitlements } from "@/lib/plan";

/**
 * Who is asking.
 *
 * Clerk owns identity; this resolves it to the local Account row that owns
 * pages and carries the plan. Two properties matter:
 *
 *   - It works with no Clerk configured. Running the app locally with no keys
 *     gives you one implicit account on the unlimited plan, so development and
 *     self-hosting do not require an auth vendor to be wired up first.
 *   - The account row is created on first sight, not by a webhook. A webhook
 *     that has not fired yet is the classic way a brand new signup lands on a
 *     broken screen, and there is no reason to depend on one for this.
 */

export type Session = {
  /** Empty string when nobody is signed in. Scoped queries then match nothing. */
  accountId: string;
  plan: string;
  ents: Entitlements;
  pagesCreated: number;
  email: string | null;
  authed: boolean;
  suspended: boolean;
  isAdmin: boolean;
  anonymous: boolean;
};

/**
 * Who runs the business.
 *
 * Read from an environment variable rather than a database flag on purpose:
 * there is no bootstrapping problem (the first admin exists before any account
 * does), and promoting someone is a deploy rather than a button, which for a
 * role that can change everyone's billing is the right amount of friction.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

const LOCAL_ID = "local";

/** The single account used when the app runs without Clerk. */
async function localAccount(): Promise<Session> {
  const row = await prisma.account.upsert({
    where: { id: LOCAL_ID },
    create: { id: LOCAL_ID, plan: "unlimited", email: null },
    update: {},
  });
  return {
    accountId: row.id,
    plan: row.plan,
    ents: entitlements(row.plan, { override: row.maxPages, suspended: row.suspended }),
    pagesCreated: row.pagesCreated,
    email: row.email,
    authed: false,
    anonymous: false,
    suspended: row.suspended,
    // With no auth vendor there is one account and it is yours, so it runs the
    // business too. Only reachable when Clerk is not configured at all.
    isAdmin: true,
  };
}

/**
 * A visitor with no account.
 *
 * This exists because the marketing page at "/" is public, so `currentSession`
 * is now reachable without a signed-in user. Falling back to the local account
 * there would be a serious hole: the local account is unlimited AND admin,
 * because it is the single-user mode used when no auth vendor is configured.
 * Returning it to a stranger would hand them the keys.
 *
 * Everything here is off, and `accountId` is empty so any owner-scoped query
 * matches nothing rather than matching the wrong thing.
 */
function anonymousSession(): Session {
  return {
    accountId: "",
    plan: "none",
    ents: {
      label: "Not signed in",
      maxPages: 0,
      canPublish: false,
      canExport: false,
      canAttachDomain: false,
      canSimulate: false,
    },
    pagesCreated: 0,
    email: null,
    authed: false,
    suspended: false,
    isAdmin: false,
    anonymous: true,
  };
}

export async function currentSession(): Promise<Session> {
  // No auth vendor configured: single-user mode, and that user owns everything.
  if (!clerkConfigured()) return localAccount();

  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  // Configured but nobody signed in — never the local account. See above.
  if (!userId) return anonymousSession();

  const existing = await prisma.account.findUnique({ where: { clerkUserId: userId } });
  if (existing) {
    return {
      accountId: existing.id,
      plan: existing.plan,
      ents: entitlements(existing.plan, {
        override: existing.maxPages,
        suspended: existing.suspended,
      }),
      pagesCreated: existing.pagesCreated,
      email: existing.email,
      authed: true,
      suspended: existing.suspended,
      isAdmin: isAdminEmail(existing.email),
      anonymous: false,
    };
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;

  // Someone who paid before they registered has a pending row waiting on their
  // email. Claim it rather than creating a second account on the trial — that
  // mismatch is a support ticket every single time.
  if (email) {
    const pending = await prisma.account.findFirst({ where: { email, clerkUserId: null } });
    if (pending) {
      const claimed = await prisma.account.update({
        where: { id: pending.id },
        data: { clerkUserId: userId },
      });
      return {
        accountId: claimed.id,
        plan: claimed.plan,
        ents: entitlements(claimed.plan, {
          override: claimed.maxPages,
          suspended: claimed.suspended,
        }),
        pagesCreated: claimed.pagesCreated,
        email: claimed.email,
        authed: true,
        suspended: claimed.suspended,
        isAdmin: isAdminEmail(claimed.email),
        anonymous: false,
      };
    }
  }

  const created = await prisma.account.create({
    data: {
      clerkUserId: userId,
      email,
      // Whatever the current default is. Free and unlimited today; flip
      // DEFAULT_PLAN to "trial" to switch the metered tier back on.
      plan: DEFAULT_PLAN,
    },
  });
  return {
    accountId: created.id,
    plan: created.plan,
    ents: entitlements(created.plan, { override: created.maxPages, suspended: created.suspended }),
    pagesCreated: created.pagesCreated,
    email: created.email,
    authed: true,
    suspended: created.suspended,
    isAdmin: isAdminEmail(created.email),
    anonymous: false,
  };
}

/** Throws unless this session runs the business. Every admin route calls it. */
export async function requireAdmin(): Promise<Session> {
  const session = await currentSession();
  if (!session.isAdmin) throw new Error("Not found");
  return session;
}

/** Throws if this account does not own the page. Every page-scoped route calls
 *  this — an id in a URL is not authorisation. */
export async function assertOwns(accountId: string, pageId: string): Promise<void> {
  if (!accountId) throw new Error("Page not found");
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { ownerId: true } });
  if (!page) throw new Error("Page not found");
  if (page.ownerId !== accountId) throw new Error("Page not found");
}
