import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { assertOwns, currentSession } from "@/lib/account";
import { resolveRange } from "@/lib/report";

/**
 * Leads for a date range, as CSV.
 *
 * Columns are the union of every field across the matching leads, because form
 * fields differ per page and a fixed header would silently drop whatever the
 * customer added. Which variant produced each lead is included — that is the
 * column that makes the export worth having, since it is the join back to
 * which angle actually earns money.
 */

export const dynamic = "force-dynamic";

function cell(value: unknown): string {
  const s = String(value ?? "");
  // Anything starting with a formula character is prefixed: a CSV opened in
  // Excel will otherwise execute it, and these values came from the internet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  await assertOwns(session.accountId, id);

  const url = new URL(req.url);
  const range = resolveRange(
    url.searchParams.get("range") ?? undefined,
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );

  const page = await prisma.page.findUnique({ where: { id }, select: { slug: true } });
  const leads = await prisma.lead.findMany({
    where: { pageId: id, createdAt: { gte: range.from, lte: range.to } },
    orderBy: { createdAt: "desc" },
    include: { variant: { select: { name: true } } },
    take: 5000,
  });

  const fields = new Set<string>();
  const rows = leads.map((l) => {
    const data = parseJson<Record<string, string>>(l.data, {});
    for (const k of Object.keys(data)) fields.add(k);
    return { l, data };
  });

  const headers = ["submitted_at", "variant", "delivered", ...[...fields]];
  const csv = [
    headers.map(cell).join(","),
    ...rows.map(({ l, data }) =>
      [
        l.createdAt.toISOString(),
        l.variant?.name ?? "",
        l.forwarded ? "yes" : "no",
        ...[...fields].map((f) => data[f] ?? ""),
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${page?.slug ?? "leads"}-${range.from.toISOString().slice(0, 10)}-to-${range.to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
