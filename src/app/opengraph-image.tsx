import { ImageResponse } from "next/og";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand-name";
import { BRAND_MARK_DATA_URI } from "@/lib/brand-mark";

/**
 * The card people actually see when the link is pasted somewhere.
 *
 * The layout is generated rather than exported as a flat image so the wording
 * cannot fall out of sync with the product's name — a rebrand is one constant
 * away. The mark itself is the real artwork, inlined (see lib/brand-mark).
 * Rendered at the size every scraper expects, so no platform has to crop it.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 86,
          background: "linear-gradient(150deg, #0b0e13 0%, #141a23 55%, #0d1117 100%)",
          color: "#e6ebf2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 44 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders
              this to a PNG; there is no browser here for next/image to help. */}
          <img src={BRAND_MARK_DATA_URI} width={52} height={52} alt="" />
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{PRODUCT_NAME}</div>
        </div>

        <div style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.08, letterSpacing: -2, maxWidth: 940 }}>
          One page, a different version for every ad angle.
        </div>

        <div style={{ fontSize: 29, color: "#98a2b0", marginTop: 30, maxWidth: 900, lineHeight: 1.4 }}>
          Describe it in chat. It is built as blocks, matched to the ad that sent each visitor, and it
          keeps testing itself.
        </div>
      </div>
    ),
    size,
  );
}
