"use client";

import { useEffect, useState } from "react";

/**
 * Where somebody puts their own Anthropic key.
 *
 * Shown as a banner the moment the free messages run out, and reachable before
 * that from the sidebar. The copy matters more than the control: being told
 * "you have run out, pay me" and being told "the AI costs money, here is how to
 * keep going for cents" are the same wall with completely different feelings,
 * and only one of them is true here.
 */
export function KeyPanel({
  message,
  onSaved,
  onDismiss,
}: {
  message?: string;
  onSaved: () => void;
  onDismiss?: () => void;
}) {
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<{ hasOwnKey: boolean; keyHint: string | null; freeRemaining: number } | null>(null);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => !d.error && setInfo(d))
      .catch(() => undefined);
  }, []);

  async function save() {
    setState("saving");
    setError("");
    const res = await fetch("/api/account", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(data.error ?? "Could not save that.");
      return;
    }
    setState("saved");
    setKey("");
    setInfo((i) => (i ? { ...i, hasOwnKey: true, keyHint: data.keyHint } : i));
    onSaved();
  }

  return (
    <div className="glass" style={{ padding: 18, margin: "0 0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 560 }}>
          {info?.hasOwnKey ? "Your Anthropic key" : "Bring your own Anthropic key"}
        </div>
        {onDismiss ? (
          <button className="btn sm ghost" onClick={onDismiss}>
            Later
          </button>
        ) : null}
      </div>

      <p className="sm" style={{ margin: "8px 0 12px" }}>
        {message ??
          (info?.hasOwnKey
            ? `Saved as ${info.keyHint}. Every page you build runs on your key, unmetered.`
            : `Adaptive LP is free. The AI that writes your pages is not, so ${info?.freeRemaining ?? 0} free messages are on the house and after that it runs on your own key. A key costs a few cents per page. Your published pages, traffic, reports and leads are never metered.`)}
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={key}
          placeholder="sk-ant-..."
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key && save()}
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
        <button className="btn primary" onClick={save} disabled={state === "saving" || !key}>
          {state === "saving" ? "Saving" : "Save"}
        </button>
      </div>

      {error ? (
        <p className="sm" style={{ color: "var(--bad)", margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}

      <p className="sm" style={{ margin: "10px 0 0", fontSize: 11.5 }}>
        Get one at console.anthropic.com. It is stored on this server, used only for your own pages, and never
        shown back to you or to anyone else. Leave the box empty and save to remove it.
      </p>
    </div>
  );
}
