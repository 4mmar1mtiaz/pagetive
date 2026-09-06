"use client";

import { useCallback, useEffect, useState } from "react";
import { PRODUCT_NAME } from "@/lib/brand-name";
import { Spinner } from "@/components/Spinner";

/**
 * Making a page readable by somebody who is not you.
 *
 * The rules are written out next to the button rather than left to be inferred,
 * because every wrong guess about sharing is expensive: people assume a link
 * hands over control, or that a colleague adding the page takes a snapshot that
 * then quietly goes stale. Both are wrong here, and finding that out later is
 * worse than reading four lines now.
 */

type Share = {
  token: string;
  url: string;
  withReport: boolean;
  views: number;
  lastViewAt: string | null;
  createdAt: string;
  addedBy: { email: string | null; at: string }[];
};

export function SharePanel({ pageId }: { pageId: string }) {
  const [share, setShare] = useState<Share | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [withReport, setWithReport] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/pages/${pageId}/share`);
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (data.error) return;
    setShare(data.share ?? null);
    if (data.share) setWithReport(data.share.withReport);
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/pages/${pageId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ withReport }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data.error) return setError(data.error);
    setShare(data.share ?? null);
  }

  async function revoke() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/pages/${pageId}/share`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data.error) return setError(data.error);
    setShare(null);
  }

  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some contexts; the input is selectable anyway.
      setError("Could not reach the clipboard — select the link and copy it.");
    }
  }

  return (
    <>
      <div className="side-label" style={{ padding: "18px 0 8px" }}>
        <span>Share</span>
        {loading ? <Spinner label="Loading" /> : null}
      </div>

      {share ? (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              value={share.url}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "rgba(255,255,255,.03)",
                color: "#fff",
                font: "inherit",
                fontSize: 12,
                outline: "none",
              }}
            />
            <button className="btn sm primary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="sm" style={{ margin: "8px 0 0" }}>
            {share.withReport ? "Page and report" : "Page only, no numbers"} ·{" "}
            {share.views === 0 ? "not opened yet" : `opened ${share.views}×`}
            {share.addedBy.length
              ? ` · added by ${share.addedBy.map((a) => a.email ?? "someone").join(", ")}`
              : ""}
          </div>

          <button
            className="btn sm ghost"
            onClick={revoke}
            disabled={busy}
            style={{ marginTop: 10, width: "100%" }}
          >
            {busy ? <Spinner label="Turning off" /> : "Turn this link off"}
          </button>
        </>
      ) : (
        <>
          <label
            className="sm"
            style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={withReport}
              onChange={(e) => setWithReport(e.target.checked)}
            />
            Include the numbers, not just the page
          </label>
          <button className="btn primary" onClick={create} disabled={busy} style={{ width: "100%" }}>
            {busy ? <Spinner label="Creating" /> : "Create a share link"}
          </button>
        </>
      )}

      {error ? (
        <p className="sm" style={{ color: "var(--bad)", margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}

      <div className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
        <strong style={{ color: "#fff" }}>How this works.</strong> Anyone holding the link can read
        this page{share?.withReport === false ? "" : " and its report"} with no {PRODUCT_NAME}{" "}
        account. They cannot edit it, publish it, or take it down — the page stays entirely yours.
        <br />
        <br />
        If they do have an account, they can add it to their workspace. That does not copy the page:
        it is the same page in two places, so the report they see keeps updating as your real traffic
        arrives. They still only ever read it.
        <br />
        <br />
        Leads are never shared, at any setting — names, emails and phone numbers stay with you. Turn
        the link off and nobody new can get in; people who already added the page keep seeing it
        until you remove them.
      </div>
    </>
  );
}
