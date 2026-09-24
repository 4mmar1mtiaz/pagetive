"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";

/**
 * The account's keys for the agent API (/api/v1).
 *
 * A new key is shown once, right here, with a copy button, and is gone the
 * moment this panel closes: the server keeps only its hash, so there is no
 * "show it again". The list after that is names and prefixes, which is enough
 * to tell keys apart and to know which one to revoke.
 */

type Key = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

const field: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "rgba(255,255,255,.03)",
  color: "#fff",
  font: "inherit",
  fontSize: 13,
  outline: "none",
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AgentKeys() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/account/keys");
    const data = await res.json().catch(() => ({}));
    if (data.error) return setError(data.error);
    setKeys(data.keys ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy("create");
    setError("");
    setCopied(false);
    const res = await fetch("/api/account/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not create a key.");
    setFresh(data.secret);
    setName("");
    setKeys((all) => [data.key, ...(all ?? [])]);
  }

  async function revoke(id: string) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/account/keys/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not revoke that key.");
    setKeys((all) => (all ?? []).filter((k) => k.id !== id));
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some contexts; the input is selectable anyway.
      setError("Could not reach the clipboard — select the key and copy it.");
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 560 }}>Agent API keys</div>
        {keys === null && !error ? <Spinner label="Loading" /> : null}
      </div>

      <p className="sm" style={{ margin: "8px 0 12px" }}>
        Let another agent or a script build pages in this workspace over /api/v1, with the same tools as the chat.
        A key acts as you, so treat it like a password.
      </p>

      {fresh ? (
        <div style={{ margin: "0 0 12px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              readOnly
              value={fresh}
              onFocus={(e) => e.currentTarget.select()}
              style={{ ...field, fontSize: 12 }}
            />
            <button className="btn sm primary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="sm" style={{ margin: "8px 0 0", fontSize: 12 }}>
            <strong style={{ color: "#fff", fontWeight: 560 }}>Copy it now.</strong> This is the only time it is
            shown; only a hash of it is kept.{" "}
            <button className="btn sm ghost" onClick={() => setFresh(null)} style={{ marginLeft: 4 }}>
              Done
            </button>
          </p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          placeholder="Name, e.g. Research agent"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && create()}
          style={field}
        />
        <button className="btn primary" onClick={create} disabled={busy !== null || !name.trim()}>
          {busy === "create" ? <Spinner label="Creating" /> : "Create key"}
        </button>
      </div>

      {keys && keys.length ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {keys.map((k) => (
            <div
              key={k.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 12.5, color: "#fff" }}>
                  {k.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--silver-faint)" }}>
                  <code>{k.prefix}…</code> · created {day(k.createdAt)} ·{" "}
                  {k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => revoke(k.id)} disabled={busy !== null}>
                {busy === k.id ? <Spinner label="Revoking" /> : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      ) : keys ? (
        <p className="sm" style={{ margin: "10px 0 0", fontSize: 12 }}>
          No keys yet.
        </p>
      ) : null}

      {error ? (
        <p className="sm" style={{ color: "var(--bad)", margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
