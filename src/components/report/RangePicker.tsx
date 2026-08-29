"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";

/**
 * Date range, as one row above the charts.
 *
 * Presets first because that is what gets clicked; the custom range is behind
 * one click so it does not take up space it has not earned. State lives in the
 * URL rather than in the component, so a range is shareable, survives a reload,
 * and the whole report stays a server render.
 */

const PRESETS: { key: string; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export function RangePicker({ current, basePath }: { current: string; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [custom, setCustom] = useState(current === "custom");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  // The range lives in the URL and the report is a server render, so changing
  // it is a navigation. Without a pending state the old numbers sit there
  // looking current for as long as the query takes, which is worse than slow:
  // it is wrong data presented as right.
  const [pending, startTransition] = useTransition();

  function go(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    startTransition(() => router.push(`${basePath}?${q.toString()}`));
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          className={`tab ${current === p.key ? "active" : ""}`}
          disabled={pending}
          onClick={() => {
            setCustom(false);
            go({ range: p.key, from: null, to: null });
          }}
        >
          {p.label}
        </button>
      ))}
      <button className={`tab ${custom ? "active" : ""}`} onClick={() => setCustom((c) => !c)}>
        Custom
      </button>

      {custom ? (
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="date-input"
            aria-label="From"
          />
          <span className="sm">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="date-input"
            aria-label="To"
          />
          <button
            className="btn sm"
            disabled={!from || pending}
            onClick={() => go({ range: "custom", from, to: to || "" })}
          >
            {pending ? <Spinner label="Loading" /> : "Apply"}
          </button>
        </span>
      ) : null}

      {pending ? <Spinner label="Updating the report" /> : null}
    </div>
  );
}
