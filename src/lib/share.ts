import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Showing a page to someone who does not have an account.
 *
 * Three things are separate on purpose, because conflating them is how sharing
 * features quietly become security holes:
 *
 *   - The **link** shows one page and, optionally, its report. It proves
 *     nothing about who is holding it, so it grants exactly reading and never
 *     anything that writes.
 *   - **Adding it to an account** puts that page in a second person's workspace
 *     with the live report, still read-only. The numbers keep updating because
 *     it is the same page, not a copy — a copy would drift the moment the owner
 *     changed anything, and a stale duplicate is worse than no share at all.
 *   - **Owning** it stays with one account. Nothing here widens that.
 *
 * The token is the whole credential, so it is 32 bytes of real randomness. Not
 * a cuid, not a slug, nothing derived from the page: a guessable share URL is
 * the same as a public page you did not mean to publish.
 */

/** URL-safe, 43 characters, ~256 bits. Long enough that guessing is not a threat model. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export type ShareState = {
  token: string;
  url: string;
  withReport: boolean;
  views: number;
  lastViewAt: string | null;
  createdAt: string;
  /** Accounts that have added this page to their own workspace. */
  addedBy: { email: string | null; at: string }[];
};

/** The live link for a page, if there is one. */
export async function shareState(pageId: string, appUrl: string): Promise<ShareState | null> {
  const share = await prisma.share.findFirst({
    where: { pageId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!share) return null;

  const grants = await prisma.pageGrant.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    include: { account: { select: { email: true } } },
  });

  return {
    token: share.token,
    url: `${appUrl}/s/${share.token}`,
    withReport: share.withReport,
    views: share.views,
    lastViewAt: share.lastViewAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    addedBy: grants.map((g) => ({ email: g.account.email, at: g.createdAt.toISOString() })),
  };
}

/**
 * Make a link, replacing whatever the page had.
 *
 * Rotating rather than accumulating: one page has one live link, so revoking is
 * a decision somebody can actually reason about. Handing out a second URL while
 * the first still works makes "who can see this" unanswerable.
 */
export async function createShare(pageId: string, withReport: boolean) {
  await prisma.share.updateMany({
    where: { pageId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return prisma.share.create({
    data: { pageId, token: newShareToken(), withReport },
  });
}

export async function revokeShare(pageId: string): Promise<void> {
  await prisma.share.updateMany({
    where: { pageId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export type ResolvedShare = {
  shareId: string;
  pageId: string;
  withReport: boolean;
};

/**
 * Who a share URL is for.
 *
 * Returns null for a token that never existed and for one that was revoked, and
 * the caller renders the same "not found" for both. Distinguishing them tells a
 * stranger that a page exists and that they are one step from it, which is a
 * fact they have not earned.
 */
export async function resolveShare(token: string): Promise<ResolvedShare | null> {
  if (!token || token.length < 20) return null;
  const share = await prisma.share.findUnique({ where: { token } });
  if (!share || share.revokedAt) return null;
  return { shareId: share.id, pageId: share.pageId, withReport: share.withReport };
}

/** Fire-and-forget: the owner wants to know the link is being used, not an audit log. */
export async function countShareView(shareId: string): Promise<void> {
  await prisma.share
    .update({ where: { id: shareId }, data: { views: { increment: 1 }, lastViewAt: new Date() } })
    .catch(() => undefined);
}

/** Put a shared page in somebody's own workspace. Idempotent — adding twice is not an error. */
export async function claimShare(share: ResolvedShare, accountId: string): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: share.pageId },
    select: { ownerId: true },
  });
  // The owner already has it. Silently succeeding beats an error nobody can act on.
  if (!page || page.ownerId === accountId) return;

  await prisma.pageGrant.upsert({
    where: { pageId_accountId: { pageId: share.pageId, accountId } },
    create: { pageId: share.pageId, accountId, shareId: share.shareId },
    update: {},
  });
}

/** Take a shared page back out of your own workspace. Only ever your own grant. */
export async function dropGrant(pageId: string, accountId: string): Promise<void> {
  await prisma.pageGrant.deleteMany({ where: { pageId, accountId } });
}

export type Access = "owner" | "viewer" | "none";

/**
 * What this account may do with this page.
 *
 * One function, called by every page-scoped route, so "can they read it" and
 * "can they change it" are answered in the same place. Split across routes,
 * the two answers drift, and the one that drifts is always the write.
 */
export async function accessTo(accountId: string, pageId: string): Promise<Access> {
  if (!accountId) return "none";
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { ownerId: true } });
  if (!page) return "none";
  if (page.ownerId === accountId) return "owner";
  const grant = await prisma.pageGrant.findUnique({
    where: { pageId_accountId: { pageId, accountId } },
  });
  return grant ? "viewer" : "none";
}

/** Throws unless this account may read the page. Message says "not found" on purpose. */
export async function assertCanView(accountId: string, pageId: string): Promise<Access> {
  const access = await accessTo(accountId, pageId);
  if (access === "none") throw new Error("Page not found");
  return access;
}

/** Page ids this account was given. Empty for most accounts, so callers can skip the join. */
export async function grantedPageIds(accountId: string): Promise<string[]> {
  if (!accountId) return [];
  const grants = await prisma.pageGrant.findMany({
    where: { accountId },
    select: { pageId: true },
  });
  return grants.map((g) => g.pageId);
}
