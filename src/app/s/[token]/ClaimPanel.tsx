"use client";

import { useState } from "react";
import { PRODUCT_NAME } from "@/lib/brand-name";
import { Spinner } from "@/components/Spinner";

/**
 * What this link is, said plainly, next to the one button that changes it.
 *
 * Sharing is the feature people get wrong in their heads: they assume a link
 * hands over the page, or that adding it makes a copy that then goes stale. So
 * the rules are written on the screen rather than in a help article nobody
 * opens — what the holder of the link can do, what adding it does, and what it
 * pointedly does not do.
 */
export function ClaimPanel({
  token,
  pageName,
  signedIn,
  alreadyHave,
  isOwner,
  withReport,
}: {
  token: string;
  pageName: string;
  signedIn: boolean;
  alreadyHave: boolean;
  isOwner: boolean;
  withReport: boolean;
}) {
  const [state, setState] = useState<"idle" | "saving" | "done">(alreadyHave ? "done" : "idle");
  const [error, setError] = useState("");

  async function add() {
    setState("saving");
    setError("");
    const res = await fetch(`/api/share/${token}/claim`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(data.error ?? "Could not add it.");
      return;
    }
    setState("done");
  }

  return (
    <div className="glass" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 560, marginBottom: 6 }}>
            {isOwner
              ? "This is your page — you are seeing your own share link"
              : state === "done"
                ? `“${pageName}” is in your workspace`
                : `“${pageName}” was shared with you`}
          </div>

          <ul className="sm" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.65 }}>
            <li>
              Anyone with this link can read the page{withReport ? " and its numbers" : ""}. No{" "}
              {PRODUCT_NAME} account needed.
            </li>
            <li>
              Nobody reading it can change anything — not the copy, not the versions, not whether it
              is live.
            </li>
            <li>
              {state === "done"
                ? "It is in your workspace now, and it is the same page rather than a copy — the report keeps updating as real traffic arrives."
                : "Add it to your account and it appears in your workspace, read-only. It stays the same page rather than becoming a copy, so the report keeps updating as real traffic arrives."}
            </li>
            <li>The owner can turn this link off at any time, which stops anyone new getting in.</li>
          </ul>
        </div>

        {isOwner ? null : state === "done" ? (
          <a className="btn sm" href="/">
            Open workspace →
          </a>
        ) : signedIn ? (
          <button className="btn primary" onClick={add} disabled={state === "saving"}>
            {state === "saving" ? <Spinner label="Adding" /> : "Add to my workspace"}
          </button>
        ) : (
          <a className="btn primary" href={`/sign-in?redirect_url=/s/${token}`}>
            Sign in to keep it
          </a>
        )}
      </div>

      {error ? (
        <p className="sm" style={{ color: "var(--bad)", margin: "10px 0 0" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
