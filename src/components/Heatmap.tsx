"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The heatmap viewer.
 *
 * The page is loaded in a same-origin iframe expanded to its full height, and
 * the overlay is drawn on top in fractional coordinates. Two things fall out of
 * rendering the page ourselves that a third-party heatmap tool cannot do:
 *
 *   - The iframe is the real page, so the map never drifts from a stale
 *     screenshot taken when the tool last crawled the site.
 *   - Because every section carries a block id, the attention layer can shade
 *     actual sections rather than guessing rectangles from pixels. "People stop
 *     reading at the pricing block" is a statement about the page, not a blob.
 *
 * The iframe is loaded with hm=1 so the page skips its own tracker — recording
 * these loads would corrupt the numbers being looked at.
 */

export type HeatPoint = { x: number; y: number; weight: number };
export type SectionRow = {
  blockId: string;
  label: string;
  reach: number;
  dwellSeconds: number;
  clicks: number;
  ctaClicks: number;
  heat: number;
};

type Mode = "clicks" | "attention" | "off";

export function Heatmap({
  slug,
  variantId,
  points,
  sections,
}: {
  slug: string;
  variantId?: string | null;
  points: HeatPoint[];
  sections: SectionRow[];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<Mode>("clicks");
  const [height, setHeight] = useState(1200);
  const [rects, setRects] = useState<{ blockId: string; top: number; height: number }[]>([]);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;

    const full = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0);
    if (full > 0) setHeight(full);

    const found: { blockId: string; top: number; height: number }[] = [];
    doc.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
      found.push({
        blockId: el.getAttribute("data-block-id") ?? "",
        top: el.offsetTop,
        height: el.offsetHeight,
      });
    });
    setRects(found);
  }, []);

  // The first measurement happens before the fonts and images settle, so the
  // height is short and the overlay sits high. Re-measuring twice covers it
  // without a resize observer inside a document we do not control.
  useEffect(() => {
    const t1 = setTimeout(measure, 400);
    const t2 = setTimeout(measure, 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [measure, height]);

  const heatOf = (blockId: string) => sections.find((s) => s.blockId === blockId);

  const src = `/p/${slug}?preview=1&hm=1${variantId ? `&v=${variantId}` : ""}`;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {(["clicks", "attention", "off"] as Mode[]).map((m) => (
          <button key={m} className={`btn sm ${mode === m ? "primary" : "ghost"}`} onClick={() => setMode(m)}>
            {m === "clicks" ? "Click map" : m === "attention" ? "Attention" : "Page only"}
          </button>
        ))}
        <span style={{ fontSize: 12, color: "var(--silver-faint)", marginLeft: "auto" }}>
          {points.length} recorded clicks
        </span>
      </div>

      <div
        className="glass"
        style={{ position: "relative", overflow: "hidden", padding: 0, background: "#0a0c10" }}
      >
        <iframe
          ref={frameRef}
          src={src}
          onLoad={measure}
          title="Heatmap"
          style={{ width: "100%", height, border: 0, display: "block" }}
        />

        {mode === "clicks" ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {points.map((p, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: p.weight > 1 ? 74 : 54,
                  height: p.weight > 1 ? 74 : 54,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "50%",
                  background:
                    p.weight > 1
                      ? "radial-gradient(circle, rgba(255,236,190,.55), rgba(255,150,90,.22) 45%, transparent 70%)"
                      : "radial-gradient(circle, rgba(200,225,255,.42), rgba(120,170,255,.16) 45%, transparent 70%)",
                  mixBlendMode: "screen",
                }}
              />
            ))}
          </div>
        ) : null}

        {mode === "attention" ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {rects.map((r) => {
              const s = heatOf(r.blockId);
              const heat = s?.heat ?? 0;
              return (
                <div
                  key={r.blockId}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: r.top,
                    height: r.height,
                    // Cool where nobody lingers, warm where they do. The border
                    // keeps section boundaries readable when two are similar.
                    background: `linear-gradient(90deg, rgba(255,${Math.round(240 - heat * 150)},${Math.round(
                      200 - heat * 190,
                    )},${0.06 + heat * 0.34}), rgba(120,170,255,${0.05 + (1 - heat) * 0.1}))`,
                    borderTop: "1px solid rgba(255,255,255,.14)",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "flex-end",
                    padding: 8,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      background: "rgba(6,8,12,.72)",
                      border: "1px solid rgba(255,255,255,.14)",
                      borderRadius: 8,
                      padding: "3px 8px",
                      fontSize: 11,
                      color: "#fff",
                    }}
                  >
                    {r.blockId} · {Math.round((s?.reach ?? 0) * 100)}% seen · {s?.dwellSeconds ?? 0}s
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
