"use client";

import { useState } from "react";

/**
 * The drop-off, as horizontal bars rather than a tapering cone.
 *
 * A funnel drawn as a cone encodes each step's value in an area, and people
 * read areas badly — a step that lost half its traffic looks like a gentle
 * narrowing. Bars from a common baseline encode it in length, which is the one
 * channel everybody reads accurately, and the biggest cliff becomes obvious
 * without anyone doing arithmetic.
 *
 * Two numbers per row, because they answer different questions: share of
 * everyone who landed, and share of the previous step. The second is the one
 * that tells you where the page is actually broken.
 */
export function Funnel({
  steps,
}: {
  steps: { step: string; explain: string; visitors: number; ofTop: number; ofPrev: number }[];
}) {
  const [open, setOpen] = useState<number | null>(null);

  // The worst transition, so the thing to fix is marked rather than hunted for.
  let worst = -1;
  let worstDrop = 0;
  steps.forEach((s, i) => {
    if (i === 0) return;
    const drop = 1 - s.ofPrev;
    if (drop > worstDrop) {
      worstDrop = drop;
      worst = i;
    }
  });

  return (
    <div className="rows">
      {steps.map((s, i) => (
        <div
          key={s.step}
          className="row-card"
          onMouseEnter={() => setOpen(i)}
          onMouseLeave={() => setOpen(null)}
          style={{ cursor: "default" }}
        >
          <div className="top">
            <span className="nm">{s.step}</span>
            <span className="sm mono">
              {s.visitors.toLocaleString()} · {Math.round(s.ofTop * 100)}%
            </span>
          </div>

          <div className="bar" style={{ height: 8 }}>
            <i style={{ width: `${Math.max(1.5, s.ofTop * 100)}%`, borderRadius: 4 }} />
          </div>

          <div className="sm" style={{ marginTop: 6 }}>
            {open === i ? s.explain : null}
            {i > 0 ? (
              <span style={{ color: i === worst ? "var(--bad)" : undefined }}>
                {open === i ? " · " : ""}
                {Math.round(s.ofPrev * 100)}% of the previous step
                {i === worst && worstDrop > 0.15
                  ? ` — biggest drop on the page, ${Math.round(worstDrop * 100)}% lost here`
                  : ""}
              </span>
            ) : (
              <span>{open === i ? "" : s.explain}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
