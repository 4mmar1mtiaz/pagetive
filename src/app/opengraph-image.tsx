import { ImageResponse } from "next/og";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand-name";

/**
 * The card people actually see when the link is pasted somewhere.
 *
 * Generated rather than designed as a file for the same reason as the icon: it
 * cannot fall out of sync with the product's name, and a rebrand is one
 * constant away. Rendered at the size every scraper expects, so no platform
 * has to crop it.
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
          <div style={{ display: "flex", position: "relative", width: 44, height: 44 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 2,
                width: 29,
                height: 40,
                borderRadius: 6,
                background: "#5b6470",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 15,
                top: 6,
                width: 29,
                height: 40,
                borderRadius: 6,
                background: "#e6ebf2",
              }}
            />
          </div>
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
