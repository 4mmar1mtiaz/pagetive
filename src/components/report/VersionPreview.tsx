"use client";

import { useState } from "react";

/**
 * The page itself, one version at a time.
 *
 * Client-side on purpose. The rest of this screen is a server render and every
 * version link is a navigation, which is right when the version decides what
 * the numbers mean — but wrong here, where it decides an iframe's src. Going
 * through the server would rebuild the whole report and blank the screen for
 * seconds to change a URL, so switching versions would feel broken exactly
 * where it needs to feel instant.
 *
 * `?v=` is the server's own way of forcing a variant, the same one a campaign
 * link uses (src/lib/serve.ts). `hm=1` turns the tracker off, because reading
 * your own page must not add impressions to the numbers on the next tab.
 */

export type PreviewVariant = {
  id: string;
  name: string;
  angle: string;
  isControl: boolean;
};

export function VersionPreview({
  slug,
  variants,
  initialId,
}: {
  slug: string;
  variants: PreviewVariant[];
  initialId: string | null;
}) {
  const [pinnedId, setPinnedId] = useState<string | null>(
    variants.some((v) => v.id === initialId) ? initialId : null,
  );

  const pinned = variants.find((v) => v.id === pinnedId) ?? null;
  const src = `/p/${slug}?preview=1&hm=1${pinned ? `&v=${pinned.id}` : ""}`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          paddingBottom: 12,
        }}
      >
        <span className="sm">Showing:</span>
        <div className="tabs">
          <button
            className={`tab ${pinned ? "" : "active"}`}
            onClick={() => setPinnedId(null)}
            title="Whatever the optimizer would serve a real visitor"
          >
            auto
          </button>
          {variants.map((v) => (
            <button
              key={v.id}
              className={`tab ${pinned?.id === v.id ? "active" : ""}`}
              onClick={() => setPinnedId(v.id)}
              title={v.angle || (v.isControl ? "the original" : v.name)}
            >
              {v.name}
            </button>
          ))}
        </div>
        <span className="sm" style={{ marginLeft: "auto" }}>
          {pinned
            ? pinned.angle || (pinned.isControl ? "the original" : "no angle set")
            : "what a real visitor would get"}
        </span>
      </div>

      <div
        className="frame-wrap"
        style={{
          height: "calc(100vh - 300px)",
          minHeight: 520,
          border: "1px solid var(--line)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <iframe src={src} title={pinned ? `Preview of ${pinned.name}` : "Preview"} />
      </div>
    </div>
  );
}
