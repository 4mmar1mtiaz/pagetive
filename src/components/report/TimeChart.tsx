"use client";

import { useState } from "react";

/**
 * One measure over time.
 *
 * Deliberately single-series. Visitors and conversions live on scales two
 * orders of magnitude apart, and the usual answer — a second y-axis — makes
 * the two lines cross wherever the author chose to put the second scale, which
 * invents a relationship that is not in the data. Two charts stacked, sharing
 * an x-axis, say the same thing without lying.
 *
 * One series also means no legend and no categorical palette: the title names
 * the measure, so identity is never carried by colour alone.
 */

const W = 820;
const H = 170;
const PAD = { top: 14, right: 12, bottom: 22, left: 34 };

export function TimeChart({
  title,
  data,
  format = (n: number) => String(n),
}: {
  title: string;
  data: { date: string; value: number }[];
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="row-card">
        <div className="nm">{title}</div>
        <div className="sm">No data in this range.</div>
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;

  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${PAD.top + innerH} L${x(0).toFixed(1)},${PAD.top + innerH} Z`;

  // Four gridlines is enough to read a value off; more is chartjunk.
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const total = data.reduce((n, d) => n + d.value, 0);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round((px - PAD.left) / (step || 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const point = hover !== null ? data[hover] : null;

  return (
    <div className="row-card" style={{ padding: "14px 14px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="nm">{title}</span>
        <span className="sm mono">
          {point ? `${point.date} · ${format(point.value)}` : `${format(total)} total`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", marginTop: 6 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${title}: ${format(total)} across ${data.length} days`}
      >
        <defs>
          <linearGradient id={`fill-${title.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a8c4e8" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#a8c4e8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => {
          const gy = y(t);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={gy}
                y2={gy}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text x={PAD.left - 7} y={gy + 3.5} textAnchor="end" fontSize="10" fill="#5f6874">
                {t}
              </text>
            </g>
          );
        })}

        <path d={area} fill={`url(#fill-${title.replace(/\W/g, "")})`} />
        <path
          d={line}
          fill="none"
          stroke="#a8c4e8"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {hover !== null ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {/* A 2px surface ring keeps the marker readable wherever it lands. */}
            <circle cx={x(hover)} cy={y(data[hover].value)} r="5.5" fill="#0b0e13" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r="4" fill="#a8c4e8" />
          </g>
        ) : null}

        <text x={PAD.left} y={H - 6} fontSize="10" fill="#5f6874">
          {data[0].date.slice(5)}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize="10" fill="#5f6874" textAnchor="end">
          {data[data.length - 1].date.slice(5)}
        </text>
      </svg>
    </div>
  );
}
