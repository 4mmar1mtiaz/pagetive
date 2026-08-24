"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminAccount } from "@/lib/admin";

/**
 * Editing an account in place.
 *
 * Every control saves immediately rather than collecting into a form with a
 * button. There is one row per customer and the changes are single fields, so
 * a save step would only add a way to lose an edit — and every one of these is
 * reversible.
 */
export function AdminTable({ accounts }: { accounts: AdminAccount[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});

  async function save(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/admin/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <div className="note" style={{ color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="row-card" style={{ padding: 0 }}>
        <table className="tbl" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>Account</th>
              <th>Plan</th>
              <th>Page limit</th>
              <th className="num">Pages</th>
              <th className="num">Visitors</th>
              <th className="num">Leads</th>
              <th className="num">AI spend</th>
              <th style={{ paddingRight: 14 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ opacity: a.suspended ? 0.55 : 1 }}>
                <td style={{ paddingLeft: 14 }}>
                  <div style={{ color: "#fff" }}>{a.email ?? "(no email yet)"}</div>
                  <div className="sm mono" style={{ fontSize: 11 }}>
                    {a.clerkUserId ? `joined ${a.joined}` : `pending · paid, not yet signed in`}
                  </div>
                </td>

                <td>
                  <select
                    className="date-input"
                    value={a.plan}
                    disabled={busy === a.id}
                    onChange={(e) => save(a.id, { plan: e.target.value })}
                  >
                    <option value="trial">Free trial</option>
                    <option value="unlimited">Unlimited</option>
                  </select>
                </td>

                <td>
                  <input
                    className="date-input"
                    style={{ width: 74 }}
                    placeholder={a.maxPages === null ? "∞" : String(a.maxPages)}
                    value={limitDraft[a.id] ?? (a.maxPagesOverride ?? "")}
                    disabled={busy === a.id}
                    onChange={(e) => setLimitDraft({ ...limitDraft, [a.id]: e.target.value })}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      const current = a.maxPagesOverride === null ? "" : String(a.maxPagesOverride);
                      if (next === current) return;
                      save(a.id, { maxPages: next === "" ? null : next });
                    }}
                    title="Blank uses the plan default. A number overrides it for this account only."
                  />
                  <div className="sm" style={{ fontSize: 10.5 }}>
                    used {a.pagesCreated}
                    {a.pagesCreated > 0 ? (
                      <button
                        className="btn sm ghost"
                        style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10 }}
                        disabled={busy === a.id}
                        onClick={() => save(a.id, { resetPageCount: true })}
                        title="Give this account its trial back"
                      >
                        reset
                      </button>
                    ) : null}
                  </div>
                </td>

                <td className="num">
                  {a.totalPages}
                  {a.livePages > 0 ? <span className="sm"> ({a.livePages} live)</span> : null}
                </td>
                <td className="num">{a.visitors.toLocaleString()}</td>
                <td className="num">{a.leads.toLocaleString()}</td>
                <td className="num">${a.spendUsd.toFixed(3)}</td>

                <td style={{ paddingRight: 14 }}>
                  <button
                    className="btn sm ghost"
                    disabled={busy === a.id}
                    onClick={() => save(a.id, { suspended: !a.suspended })}
                    style={{ color: a.suspended ? "var(--warn)" : undefined }}
                  >
                    {a.suspended ? "Reactivate" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
