import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { pageAnalytics } from "@/lib/analytics";
import { pageReport, resolveRange } from "@/lib/report";
import { currentSession } from "@/lib/account";
import { Heatmap } from "@/components/Heatmap";
import { Funnel } from "@/components/report/Funnel";
import { TimeChart } from "@/components/report/TimeChart";
import { RangePicker } from "@/components/report/RangePicker";
import { Spinner } from "@/components/Spinner";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string; range?: string; from?: string; to?: string; tab?: string }>;
};

function pct(n: number): string {
  return `${(n * 100).toFixed(n >= 0.1 || n === 0 ? 0 : 1)}%`;
}

/** Change against the same length of time immediately before. Rendered with an
 *  arrow and a word, never colour alone. */
function Delta({ now, before, invert }: { now: number; before: number | undefined; invert?: boolean }) {
  if (before === undefined || before === 0) return null;
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return <div className="delta flat">no change</div>;
  const better = invert ? change < 0 : change > 0;
  return (
    <div className={`delta ${better ? "up" : "down"}`}>
      {change > 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(0)}% vs previous
    </div>
  );
}

export default async function PageDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "heatmap" ? "heatmap" : "report";

  const session = await currentSession();
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.ownerId !== session.accountId) notFound();

  const range = resolveRange(sp.range, sp.from, sp.to);
  const report = await pageReport(id, { range, variantId: sp.v ?? null });

  const basePath = `/pages/${id}`;
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (sp.range) q.set("range", sp.range);
    if (sp.from) q.set("from", sp.from);
    if (sp.to) q.set("to", sp.to);
    if (sp.v) q.set("v", sp.v);
    for (const [k, v] of Object.entries(extra)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    return `${basePath}?${q.toString()}`;
  };

  const topSource = Math.max(1, ...report.sources.map((s) => s.visitors));

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 20px 90px" }}>
      {/* ---- header ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Link className="btn sm ghost" href="/">
          ← Workspace
        </Link>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>{page.name}</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--silver-faint)" }}>
            /p/{page.slug} · {page.status} · {report.range.label}
          </div>
        </div>
        <div className="tabs">
          <Link className={`tab ${tab === "report" ? "active" : ""}`} href={keep({ tab: "" })}>
            Report
          </Link>
          <Link className={`tab ${tab === "heatmap" ? "active" : ""}`} href={keep({ tab: "heatmap" })}>
            Heatmap
          </Link>
        </div>
        <a className="btn sm ghost" href={`/p/${page.slug}?preview=1`} target="_blank" rel="noreferrer">
          Open page
        </a>
      </div>

      {/* ---- controls: one row above the charts ---- */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 18,
          paddingBottom: 14,
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Suspense fallback={<Spinner block label="Loading the heatmap" />}>
          <RangePicker current={report.range.key} basePath={basePath} />
        </Suspense>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="sm">Version:</span>
          <Link className={`tab ${!sp.v ? "active" : ""}`} href={keep({ v: "" })}>
            all
          </Link>
          {report.variants.map((v) => (
            <Link key={v.id} className={`tab ${sp.v === v.id ? "active" : ""}`} href={keep({ v: v.id })}>
              {v.name}
            </Link>
          ))}
        </span>
      </div>

      {/* ---- headline numbers ---- */}
      <div className="kpis" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="v">{report.totals.visitors.toLocaleString()}</div>
          <div className="l">people</div>
          <Delta now={report.totals.visitors} before={report.previous?.visitors} />
        </div>
        <div className="kpi">
          <div className="v">{report.totals.conversions.toLocaleString()}</div>
          <div className="l">converted</div>
          <Delta now={report.totals.conversions} before={report.previous?.conversions} />
        </div>
        <div className="kpi">
          <div className="v">{pct(report.totals.cvr)}</div>
          <div className="l">conversion rate</div>
          <Delta now={report.totals.cvr} before={report.previous?.cvr} />
        </div>
        <div className="kpi">
          <div className="v">{report.totals.medianSeconds}s</div>
          <div className="l">median on page</div>
        </div>
        <div className="kpi">
          <div className="v">{report.totals.returning}</div>
          <div className="l">came back</div>
        </div>
        <div className="kpi">
          <div className="v">{report.totals.leads}</div>
          <div className="l">leads captured</div>
        </div>
      </div>

      {tab === "heatmap" ? (
        <HeatmapTab pageId={id} slug={page.slug} variantId={sp.v ?? null} />
      ) : (
        <div className="report-grid">
          {/* ---- left column ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
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

            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                Where they came from
              </div>
              <div className="row-card">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Type</th>
                      <th style={{ width: "22%" }}></th>
                      <th className="num">People</th>
                      <th className="num">Conv.</th>
                      <th className="num">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map((s) => (
                      <tr key={s.label}>
                        <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</td>
                        <td className="sm">{s.kind}</td>
                        <td>
                          <div className="minibar">
                            <i style={{ width: `${(s.visitors / topSource) * 100}%` }} />
                          </div>
                        </td>
                        <td className="num">{s.visitors}</td>
                        <td className="num">{s.conversions}</td>
                        <td className="num">{pct(s.cvr)}</td>
                      </tr>
                    ))}
                    {report.sources.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="sm">
                          No traffic in this range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                Section by section
              </div>
              <div className="row-card">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th className="num">Seen by</th>
                      <th className="num">Attention</th>
                      <th className="num">Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sections.map((s) => (
                      <tr key={s.blockId}>
                        <td>
                          <div style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.label}
                          </div>
                          <div className="sm mono">{s.blockId}</div>
                        </td>
                        <td className="num">{pct(s.reach)}</td>
                        <td className="num">{s.dwellSeconds}s</td>
                        <td className="num">{s.clicks + s.ctaClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ---- right column ---- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                Versions
              </div>
              <div className="rows">
                {report.variants.map((v) => (
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
                    <div className="sm">
                      {v.targeted ? "targeted · " : ""}
                      {v.angle || "original"}
                    </div>
                    <div className="sm">
                      {v.visitors} people · {v.conversions} conv · {pct(v.cvr)} ·{" "}
                      {Math.round(v.winProbability * 100)}% to win
                    </div>
                    <div className="bar">
                      <i style={{ width: `${Math.max(2, v.winProbability * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                Devices
              </div>
              <div className="row-card">
                <table className="tbl">
                  <tbody>
                    {report.devices.map((d) => (
                      <tr key={d.label}>
                        <td>{d.label}</td>
                        <td className="num">{d.visitors}</td>
                        <td className="num">{pct(d.cvr)}</td>
                      </tr>
                    ))}
                    {report.devices.length === 0 ? (
                      <tr>
                        <td className="sm">No data.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                How far they scrolled
              </div>
              <div className="row-card">
                {report.scroll.map((s) => (
                  <div key={s.depth} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span className="mono sm" style={{ width: 34 }}>
                      {s.depth}%
                    </span>
                    <div className="minibar" style={{ flex: 1 }}>
                      <i style={{ width: `${Math.max(1, s.share * 100)}%` }} />
                    </div>
                    <span className="mono sm" style={{ width: 34, textAlign: "right" }}>
                      {Math.round(s.share * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="side-label" style={{ padding: "0 0 10px" }}>
                <span>Leads</span>
                <a className="btn sm ghost" href={`/api/pages/${id}/leads.csv?${new URLSearchParams({ range: report.range.key, from: report.range.from, to: report.range.to })}`}>
                  CSV
                </a>
              </div>
              <div className="rows">
                {report.leads.slice(0, 12).map((l, i) => (
                  <div className="row-card" key={i}>
                    <div className="top">
                      <span className="nm">{l.data.email || l.data.name || "Lead"}</span>
                      <span className={`tag ${l.suspect ? "bad" : l.forwarded ? "good" : "warn"}`}>
                        {l.suspect ? "held" : l.forwarded ? "delivered" : "stored"}
                      </span>
                    </div>
                    <div className="sm mono">
                      {l.at}
                      {l.variant ? ` · ${l.variant}` : ""}
                    </div>
                  </div>
                ))}
                {report.leads.length === 0 ? <div className="note">No leads in this range.</div> : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The heatmap needs the coordinate data, which the report does not carry. */
async function HeatmapTab({
  pageId,
  slug,
  variantId,
}: {
  pageId: string;
  slug: string;
  variantId: string | null;
}) {
  const stats = await pageAnalytics(pageId, variantId);
  return <Heatmap slug={slug} variantId={variantId} points={stats.heat} sections={stats.sections} />;
}
