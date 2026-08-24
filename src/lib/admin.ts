import { prisma } from "@/lib/db";
import { entitlements } from "@/lib/plan";

/**
 * The agency view: every account, what it is using, and what it costs you.
 *
 * One query per aggregate rather than a join, because the interesting numbers
 * live in four tables and Prisma's groupBy on each is both clearer and faster
 * than one query wide enough to carry them all. At the scale this screen is
 * for — tens to hundreds of accounts — the difference is unmeasurable, and the
 * code stays readable.
 */

export type AdminAccount = {
  id: string;
  email: string | null;
  clerkUserId: string | null;
  plan: string;
  planLabel: string;
  suspended: boolean;
  note: string | null;
  /** Effective limit: the per-account override if set, otherwise the plan's. */
  maxPages: number | null;
  maxPagesOverride: number | null;
  pagesCreated: number;
  livePages: number;
  totalPages: number;
  leads: number;
  visitors: number;
  spendUsd: number;
  joined: string;
};

export async function listAccounts(): Promise<{
  accounts: AdminAccount[];
  totals: { accounts: number; pages: number; leads: number; spendUsd: number };
}> {
  const rows = await prisma.account.findMany({ orderBy: { createdAt: "desc" } });

  const [pageGroups, liveGroups, spendGroups] = await Promise.all([
    prisma.page.groupBy({ by: ["ownerId"], _count: true }),
    prisma.page.groupBy({ by: ["ownerId"], where: { status: "live" }, _count: true }),
    prisma.usage.groupBy({ by: ["accountId"], _sum: { costUsd: true } }),
  ]);

  // Leads and visitors hang off pages, so they are counted per owner through
  // the page they belong to.
  const pages = await prisma.page.findMany({ select: { id: true, ownerId: true } });
  const ownerOfPage = new Map(pages.map((p) => [p.id, p.ownerId]));

  const [leadRows, viewRows] = await Promise.all([
    prisma.lead.groupBy({ by: ["pageId"], _count: true }),
    prisma.event.groupBy({ by: ["pageId"], where: { type: "view" }, _count: true }),
  ]);

  const leadsByOwner = new Map<string, number>();
  for (const r of leadRows) {
    const owner = ownerOfPage.get(r.pageId);
    if (owner) leadsByOwner.set(owner, (leadsByOwner.get(owner) ?? 0) + r._count);
  }
  const viewsByOwner = new Map<string, number>();
  for (const r of viewRows) {
    const owner = ownerOfPage.get(r.pageId);
    if (owner) viewsByOwner.set(owner, (viewsByOwner.get(owner) ?? 0) + r._count);
  }

  const count = (groups: { ownerId: string; _count: number }[], id: string) =>
    groups.find((g) => g.ownerId === id)?._count ?? 0;

  const accounts: AdminAccount[] = rows.map((a) => {
    const ents = entitlements(a.plan, { override: a.maxPages, suspended: a.suspended });
    return {
      id: a.id,
      email: a.email,
      clerkUserId: a.clerkUserId,
      plan: a.plan,
      planLabel: ents.label,
      suspended: a.suspended,
      note: a.note,
      maxPages: ents.maxPages,
      maxPagesOverride: a.maxPages,
      pagesCreated: a.pagesCreated,
      livePages: count(liveGroups, a.id),
      totalPages: count(pageGroups, a.id),
      leads: leadsByOwner.get(a.id) ?? 0,
      visitors: viewsByOwner.get(a.id) ?? 0,
      spendUsd:
        Math.round((spendGroups.find((g) => g.accountId === a.id)?._sum.costUsd ?? 0) * 10000) / 10000,
      joined: a.createdAt.toISOString().slice(0, 10),
    };
  });

  return {
    accounts,
    totals: {
      accounts: accounts.length,
      pages: accounts.reduce((n, a) => n + a.totalPages, 0),
      leads: accounts.reduce((n, a) => n + a.leads, 0),
      spendUsd: Math.round(accounts.reduce((n, a) => n + a.spendUsd, 0) * 10000) / 10000,
    },
  };
}
