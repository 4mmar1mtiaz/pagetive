import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { pageReport, resolveRange } from "@/lib/report";
import { accessTo, countShareView, resolveShare } from "@/lib/share";
import { PRODUCT_NAME } from "@/lib/brand-name";
import { VersionPreview } from "@/components/report/VersionPreview";
import { Funnel } from "@/components/report/Funnel";
import { TimeChart } from "@/components/report/TimeChart";
import { ClaimPanel } from "./ClaimPanel";

/**
 * A page, shown to somebody who was sent a link.
 *
 * Read-only all the way down, and it says so. There is no edit surface here at
 * all rather than a disabled one: a greyed-out publish button invites a support
 * question, and the honest shape of this screen is "here is the work and here
 * is how it is doing", not "here is the workspace, minus the parts you cannot
 * touch".
 *
 * The report travels only if the owner said it should. The page itself always
 * does — a link that shows nothing is not a share.
 */

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
};

function pct(n: number): string {
  return `${(n * 100).toFixed(n >= 0.1 || n === 0 ? 0 : 1)}%`;
}

export default async function SharedPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;

  const share = await resolveShare(token);
  // A revoked link and a token that never existed render identically. Telling
  // a stranger "this used to work" tells them a page is there.
  if (!share) notFound();

  const page = await prisma.page.findUnique({ where: { id: share.pageId } });
  if (!page) notFound();

  const session = await currentSession();
  const access = await accessTo(session.accountId, page.id);

  // The owner checking their own link should not inflate its view count.
  if (access !== "owner") await countShareView(share.shareId);

  const range = resolveRange(sp.range, sp.from, sp.to);
  const report = share.withReport ? await pageReport(page.id, { range, variantId: null }) : null;

  // Variants are listed whether or not the numbers are, because "four versions
  // of this page exist" is the thing being shown off.
  const variants = (
    report?.variants ??
    (await prisma.variant.findMany({
      where: { pageId: page.id, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, angle: true, isControl: true, active: true },
    }))
  ).filter((v) => v.active);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 20px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="mark" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>{page.name}</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--silver-faint)" }}>
            shared from {PRODUCT_NAME} · {page.status}
            {report ? ` · ${report.range.label}` : ""}
          </div>
        </div>
        {page.status === "live" ? (
          <a className="btn sm ghost" href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
            Open the live page
          </a>
        ) : null}
      </div>

      <ClaimPanel
        token={token}
        pageName={page.name}
        signedIn={!session.anonymous}
        alreadyHave={access === "viewer"}
        isOwner={access === "owner"}
        withReport={share.withReport}
      />

      {report ? (
        <div className="kpis" style={{ marginBottom: 20 }}>
          <div className="kpi">
            <div className="v">{report.totals.visitors.toLocaleString()}</div>
            <div className="l">people</div>
          </div>
          <div className="kpi">
            <div className="v">{report.totals.conversions.toLocaleString()}</div>
            <div className="l">converted</div>
          </div>
          <div className="kpi">
            <div className="v">{pct(report.totals.cvr)}</div>
            <div className="l">conversion rate</div>
          </div>
          <div className="kpi">
            <div className="v">{report.totals.medianSeconds}s</div>
            <div className="l">median on page</div>
          </div>
          <div className="kpi">
            <div className="v">{report.totals.leads}</div>
            <div className="l">leads captured</div>
          </div>
        </div>
      ) : (
        <div className="note" style={{ marginBottom: 18 }}>
          The owner shared the page without its numbers.
        </div>
      )}

      <div className="report-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div>
            <div className="side-label" style={{ padding: "0 0 10px" }}>
              <span>The page</span>
              <span className="sm">switch versions to see each one</span>
            </div>
            <VersionPreview
              slug={page.slug}
              variants={variants.map((v) => ({
                id: v.id,
                name: v.name,
                angle: v.angle,
                isControl: v.isControl,
              }))}
              initialId={null}
            />
          </div>

          {report ? (
            <>
              <div>
                <div className="side-label" style={{ padding: "0 0 10px" }}>
                  <span>Over time</span>
                  <span className="sm">hover for a day</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <TimeChart
                    title="People"
                    data={report.daily.map((d) => ({ date: d.date, value: d.visitors }))}
                  />
                  <TimeChart
                    title="Conversions"
                    data={report.daily.map((d) => ({ date: d.date, value: d.conversions }))}
                  />
                </div>
              </div>

              <div>
                <div className="side-label" style={{ padding: "0 0 10px" }}>
                  <span>What they did</span>
                  <span className="sm">unique people, not events</span>
                </div>
                <Funnel steps={report.funnel} />
              </div>
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div>
            <div className="side-label" style={{ padding: "0 0 10px" }}>
              Versions
            </div>
            <div className="rows">
              {(report?.variants ?? []).map((v) => (
                <div className="row-card" key={v.id}>
                  <div className="top">
                    <span className="nm">{v.name}</span>
                    <span
                      className={`tag ${
                        v.flag === "winning" ? "good" : v.flag === "losing" ? "bad" : v.flag === "starved" ? "warn" : ""
                      }`}
                    >
                      {v.flag}
                    </span>
                  </div>
                  <div className="sm">{v.angle || "original"}</div>
                  <div className="sm">
                    {v.visitors} people · {v.conversions} conv · {pct(v.cvr)} ·{" "}
                    {Math.round(v.winProbability * 100)}% to win
                  </div>
                  <div className="bar">
                    <i style={{ width: `${Math.max(2, v.winProbability * 100)}%` }} />
                  </div>
                </div>
              ))}
              {report
                ? null
                : variants.map((v) => (
                    <div className="row-card" key={v.id}>
                      <div className="top">
                        <span className="nm">{v.name}</span>
                      </div>
                      <div className="sm">{v.angle || "original"}</div>
                    </div>
                  ))}
              {variants.length === 0 ? <div className="note">One version, no test running.</div> : null}
            </div>
          </div>

          {/* Leads are never on a share link, at any setting. They are other
              people's names, emails and phone numbers, and the owner sharing a
              performance report is not consenting to hand those out. */}
          <div className="note">
            Leads stay with the owner. A share link never carries anyone&apos;s contact details.
          </div>
        </div>
      </div>
    </div>
  );
}
