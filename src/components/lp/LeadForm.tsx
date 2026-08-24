"use client";

import { useRef, useState } from "react";
import type { FormField } from "@/lib/blocks";

/**
 * The conversion path.
 *
 * Submits to our own endpoint rather than the customer's CRM directly, for two
 * reasons that are both about not losing leads: the row is persisted here
 * before any forwarding is attempted, and a CRM that is down or misconfigured
 * produces a stored lead plus a logged error instead of a browser error on the
 * visitor's screen.
 */
export function LeadForm({
  pageId,
  variantId,
  blockId,
  fields,
  submitText,
  successMessage,
  redirectUrl,
}: {
  pageId: string;
  variantId: string | null;
  blockId: string;
  fields: FormField[];
  submitText: string;
  successMessage: string;
  redirectUrl?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  // When this form appeared. A submit within a second and a half of render did
  // not come from somebody reading it.
  const renderedAt = useRef(Date.now());

  // Form-start is the single most diagnostic event on a landing page: the gap
  // between starts and submits is where a bad field order shows up.
  function markStart() {
    if (started) return;
    setStarted(true);
    window.dispatchEvent(new CustomEvent("alp:form_start", { detail: { blockId } }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError("");

    const form = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k === "company_website") continue; // the honeypot never becomes lead data
      data[k] = String(v);
    }

    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pageId,
          variantId,
          blockId,
          data,
          url: window.location.href,
          _hp: String(form.get("company_website") ?? ""),
          _elapsed: Date.now() - renderedAt.current,
          // Sent so the conversion joins the same visitor's other events; the
          // server falls back to anonymous when the tracker is disabled.
          visitorId: document.cookie.match(/(?:^|;)\s*alp_vid\s*=\s*([^;]+)/)?.[1] ?? undefined,
          sessionId: (() => { try { return sessionStorage.getItem("alp_sid") ?? undefined; } catch { return undefined; } })(),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      window.dispatchEvent(new CustomEvent("alp:conversion", { detail: { blockId } }));
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      setState("done");
    } catch (err) {
      setState("idle");
      setError((err as Error).message || "Something went wrong. Try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="form-done">
        <span className="tick">✓</span>
        <p>{successMessage}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} onFocus={markStart}>
      {/*
        Honeypot. Hidden from sight, from the tab order and from screen
        readers, so no person can reach it — while a bot that fills every input
        it finds gives itself away. Positioned off-canvas rather than
        display:none, which some bots specifically skip.
      */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <input type="text" name="company_website" tabIndex={-1} autoComplete="off" />
      </div>
      {fields.map((f) => {
        const id = `${blockId}-${f.name}`;
        return (
          <label key={f.name} htmlFor={id}>
            {f.label ?? f.name}
            {f.type === "textarea" ? (
              <textarea id={id} name={f.name} placeholder={f.placeholder} required={f.required} />
            ) : f.type === "select" ? (
              <select id={id} name={f.name} required={f.required} defaultValue="">
                <option value="" disabled>
                  {f.placeholder ?? "Choose one"}
                </option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={f.name}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                required={f.required}
                autoComplete={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "on"}
              />
            )}
          </label>
        );
      })}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : submitText}
      </button>
    </form>
  );
}
