"use client";

import { useCallback, useEffect, useState } from "react";
import type { PageAnalytics } from "@/lib/analytics";
import type { PageRow, PlanState } from "@/components/types";

/**
 * The right-hand rail: the page as it actually looks, the numbers it is
 * actually doing, and the four settings that decide where a lead ends up.
 *
 * It sits next to the chat rather than behind a navigation click because the
 * feedback loop is the product — you say "make the headline harder" and watch
 * it change.
 */

type Tab = "preview" | "data" | "setup";

function pct(n: number): string {
  return `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`;
}

export function Rail({
  page,
  plan,
  onChanged,
  refreshKey,
}: {
  page: PageRow | null;
  plan: PlanState | null;
  onChanged: () => void;
  refreshKey: number;
}) {
  const [tab, setTab] = useState<Tab>("preview");
  const [stats, setStats] = useState<PageAnalytics | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [simming, setSimming] = useState(false);
  const [domains, setDomains] = useState<
    { id: string; hostname: string; verified: boolean; note: string | null; plan: { records: { type: string; name: string; value: string }[]; explain: string; ready: boolean } }[]
  >([]);
  const [newHost, setNewHost] = useState("");
  const [domainError, setDomainError] = useState("");
  const [spend, setSpend] = useState<{ usd: number } | null>(null);

  const pageId = page?.id ?? null;

  // Any tool call can change the page under us, so the preview is remounted and
  // the numbers refetched whenever the chat reports work finished.
  useEffect(() => {
    setFrameKey((k) => k + 1);
  }, [refreshKey, pageId]);

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    fetch(`/api/pages/${pageId}/analytics`)
      .then((r) => r.json())
      .then((d) => !cancelled && setStats(d.error ? null : d))
      .catch(() => undefined);
    fetch(`/api/pages/${pageId}/domains`)
      .then((r) => r.json())
      .then((d) => !cancelled && setDomains(d.domains ?? []))
      .catch(() => undefined);
    fetch(`/api/usage?page=${pageId}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setSpend(d.page ?? null))
      .catch(() => undefined);
    fetch(`/api/pages/${pageId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.page) return;
        try {
          setSettings(JSON.parse(d.page.settings || "{}"));
        } catch {
          setSettings({});
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pageId, refreshKey]);

  const [blocked, setBlocked] = useState("");

  const publish = useCallback(async () => {
    if (!page) return;
    setBusy(true);
    setBlocked("");
    const res = await fetch(`/api/pages/${page.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: page.status === "live" ? "draft" : "live" }),
    });
    setBusy(false);
    if (res.status === 402) {
      // The server is the authority on entitlement; show exactly what it said.
      setBlocked((await res.json().catch(() => ({}))).error ?? "Not available on your plan.");
      return;
    }
    onChanged();
  }, [page, onChanged]);

  /** Synthetic visitors, so the analytics have something to show on day one. */
  async function simulate(clear = false) {
    if (!page) return;
    setSimming(true);
    await fetch(`/api/pages/${page.id}/simulate`, {
      method: clear ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: clear ? undefined : JSON.stringify({ visitors: 600, days: 14 }),
    });
    setSimming(false);
    onChanged();
  }

  async function addDomain() {
    if (!page || !newHost.trim()) return;
    setDomainError("");
    const res = await fetch(`/api/pages/${page.id}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: newHost }),
    });
    const data = await res.json();
    if (data.error) {
      setDomainError(data.error);
      return;
    }
    setNewHost("");
    const list = await fetch(`/api/pages/${page.id}/domains`).then((r) => r.json());
    setDomains(list.domains ?? []);
  }

  async function verifyDomainRow(domainId: string) {
    if (!page) return;
    await fetch(`/api/domains/${domainId}/verify`, { method: "POST" });
    const list = await fetch(`/api/pages/${page.id}/domains`).then((r) => r.json());
    setDomains(list.domains ?? []);
  }

  async function removeDomain(domainId: string) {
    if (!page) return;
    await fetch(`/api/domains/${domainId}`, { method: "DELETE" });
    setDomains((d) => d.filter((x) => x.id !== domainId));
  }

  async function saveSettings() {
    if (!page) return;
    setSaving(true);
    await fetch(`/api/pages/${page.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setSaving(false);
    setFrameKey((k) => k + 1);
  }

  if (!page) {
    return (
      <div className="glass col rail" style={{ height: "100%" }}>
        <div className="rail-head">
          <span className="chat-title">Preview</span>
        </div>
        <div className="pad" style={{ color: "var(--silver-faint)", fontSize: 13 }}>
          No page selected yet. Build one in the chat and it appears here — live preview, live numbers, and the
          settings that decide where a form fill ends up.
        </div>
      </div>
    );
  }

  const canPublish = plan?.canPublish ?? true;
  const canExport = plan?.canExport ?? true;
  const canDomain = plan?.canAttachDomain ?? true;

  const field = (key: string, label: string, placeholder: string) => (
    <div className="field-row" key={key}>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        value={settings[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="glass col rail" style={{ height: "100%" }}>
      <div className="rail-head">
        <div style={{ minWidth: 0 }}>
          <div className="chat-title truncate">{page.name}</div>
          <div className="mono" style={{ color: "var(--silver-faint)", fontSize: 11 }}>
            /p/{page.slug}
          </div>
        </div>
        <div className="tabs">
          {(["preview", "data", "setup"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "preview" ? (
        <>
          <div className="frame-wrap" style={{ flex: 1 }}>
            <iframe key={frameKey} src={`/p/${page.slug}?preview=1&hm=1`} title="Preview" />
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 12,
              borderTop: "1px solid var(--line)",
              alignItems: "center",
            }}
          >
            <span className={`dot ${page.status === "live" ? "live" : "draft"}`} />
            <span style={{ fontSize: 12, color: "var(--silver-faint)", flex: 1 }}>
              {page.status === "live" ? "Live" : "Draft — not public"}
            </span>
            <a className="btn sm ghost" href={`/pages/${page.id}`}>
              Heatmap
            </a>
            <a className="btn sm ghost" href={`/p/${page.slug}?preview=1`} target="_blank" rel="noreferrer">
              Open
            </a>
            {canExport ? (
              <a className="btn sm ghost" href={`/api/pages/${page.id}/export`}>
                Export
              </a>
            ) : null}
            <button
              className="btn sm primary"
              onClick={publish}
              disabled={busy || (!canPublish && page.status !== "live")}
              title={canPublish ? undefined : "Publishing needs the unlimited plan"}
            >
              {page.status === "live" ? "Unpublish" : "Publish"}
            </button>
          </div>
          {blocked || (!canPublish && page.status !== "live") ? (
            <div className="note" style={{ margin: "0 12px 12px" }}>
              {blocked ||
                "Preview is fully working — publishing and export are on the unlimited plan."}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "data" ? (
        <div className="rail-body pad">
          <div className="kpis">
            <div className="kpi">
              <div className="v">{stats?.totals.views ?? 0}</div>
              <div className="l">views</div>
            </div>
            <div className="kpi">
              <div className="v">{stats?.totals.leads ?? 0}</div>
              <div className="l">leads</div>
            </div>
            <div className="kpi">
              <div className="v">{stats ? pct(stats.totals.cvr) : "0%"}</div>
              <div className="l">cvr</div>
            </div>
          </div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Variants
          </div>
          <div className="rows">
            {(stats?.variants ?? []).map((v) => (
              <div className="row-card" key={v.id}>
                <div className="top">
                  <span className="nm">{v.name}</span>
                  <span className={`tag ${v.flag === "winning" ? "good" : v.flag === "losing" ? "bad" : v.flag === "starved" ? "warn" : ""}`}>
                    {v.flag}
                  </span>
                </div>
                <div className="sm">
                  {v.impressions} impressions · {v.conversions} conversions · {pct(v.cvr)} CVR ·{" "}
                  {Math.round(v.winProbability * 100)}% chance to win
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(2, v.winProbability * 100)}%` }} />
                </div>
              </div>
            ))}
            {(stats?.variants.length ?? 0) === 0 ? (
              <div className="note">No variants yet. Ask the chat to generate some angles.</div>
            ) : null}
          </div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Sections
          </div>
          <div className="rows">
            {(stats?.sections ?? []).map((s) => (
              <div className="row-card" key={s.blockId}>
                <div className="top">
                  <span className="nm truncate">{s.label}</span>
                  <span className="sm mono">{s.blockId}</span>
                </div>
                <div className="sm">
                  seen by {pct(s.reach)} · {s.dwellSeconds}s attention · {s.clicks + s.ctaClicks} clicks
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(2, s.heat * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Test data
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={() => simulate(false)} disabled={simming} style={{ flex: 1 }}>
              {simming ? "Running…" : "Simulate 600 visitors"}
            </button>
            <button className="btn sm ghost" onClick={() => simulate(true)} disabled={simming}>
              Clear
            </button>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            Synthetic visitors over the last 14 days. Each variant gets a hidden true conversion rate, so the
            optimizer has a real winner to find. Clear removes them without touching real traffic.
          </div>

          {spend ? (
            <div className="note" style={{ marginTop: 10 }}>
              Model spend on this page: <strong>${spend.usd.toFixed(3)}</strong>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "setup" ? (
        <div className="rail-body pad">
          {field("crmWebhookUrl", "CRM webhook", "https://hooks.zapier.com/… or your GHL inbound URL")}
          {field("notifyEmail", "Notify email", "you@company.com, sales@company.com")}
          {field("calendarUrl", "Calendar embed", "https://cal.com/you/30min")}
          {field("redirectUrl", "After submit", "Leave blank to show the thank-you message")}

          <button className="btn primary" onClick={saveSettings} disabled={saving} style={{ width: "100%" }}>
            {saving ? "Saving…" : "Save"}
          </button>

          <div className="note" style={{ marginTop: 14 }}>
            Every form fill is stored here first, then POSTed to the webhook as JSON and emailed. A webhook that
            fails does not lose the lead — the row keeps the error.
          </div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Live URL
          </div>
          <div className="mono note">{`${typeof window !== "undefined" ? window.location.origin : ""}/p/${page.slug}`}</div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Domains
          </div>
          {!canDomain ? (
            <div className="note" style={{ marginBottom: 10 }}>
              Custom domains are on the unlimited plan. Your page still works on its /p/ link.
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginBottom: 10, opacity: canDomain ? 1 : 0.45 }}>
            <input
              value={newHost}
              placeholder="offer.clientsite.com"
              onChange={(e) => setNewHost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDomain()}
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "rgba(255,255,255,.03)",
                color: "#fff",
                font: "inherit",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button className="btn sm" onClick={addDomain} disabled={!canDomain}>
              Attach
            </button>
          </div>
          {domainError ? (
            <div className="note" style={{ color: "var(--bad)", marginBottom: 10 }}>
              {domainError}
            </div>
          ) : null}

          <div className="rows">
            {domains.map((d) => (
              <div className="row-card" key={d.id}>
                <div className="top">
                  <span className="nm mono truncate">{d.hostname}</span>
                  <span className={`tag ${d.verified ? "good" : "warn"}`}>{d.verified ? "live" : "dns pending"}</span>
                </div>
                {d.plan.records.length > 0 ? (
                  <div className="sm mono" style={{ marginTop: 6 }}>
                    {d.plan.records.map((r, i) => (
                      <div key={i}>
                        {r.type} &nbsp; {r.name} &nbsp;→&nbsp; {r.value}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="sm" style={{ marginTop: 6 }}>
                  {d.note ?? d.plan.explain}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {!d.verified ? (
                    <button className="btn sm ghost" onClick={() => verifyDomainRow(d.id)}>
                      Check DNS
                    </button>
                  ) : null}
                  <button className="btn sm ghost" onClick={() => removeDomain(d.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {domains.length === 0 ? (
              <div className="note">
                No hostname attached — the page lives on /p/{page.slug}. Set WILDCARD_ROOT in .env and every
                subdomain of it works instantly with no DNS work per page.
              </div>
            ) : null}
          </div>

          <div className="side-label" style={{ padding: "18px 0 8px" }}>
            Danger
          </div>
          <button
            className="btn"
            style={{ width: "100%", color: "var(--bad)" }}
            onClick={async () => {
              // Deletes the page, its variants, its events and its leads. The
              // confirm is the only guard — there is no trash to restore from.
              if (!confirm(`Delete "${page.name}" and every lead and event it recorded?`)) return;
              await fetch(`/api/pages/${page.id}`, { method: "DELETE" });
              onChanged();
            }}
          >
            Delete this page
          </button>
        </div>
      ) : null}
    </div>
  );
}
