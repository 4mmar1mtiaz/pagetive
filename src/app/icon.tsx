import { ImageResponse } from "next/og";

/**
 * The favicon, drawn rather than shipped as a file.
 *
 * The mark is the product in one glyph: a page, and a second version of the
 * same page behind it. Generating it here keeps it in sync with the palette
 * and means there is no binary in the repository to go stale after a rebrand.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d1117",
          borderRadius: 7,
        }}
      >
        <div style={{ display: "flex", position: "relative", width: 18, height: 18 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 12,
              height: 16,
              borderRadius: 2,
              background: "#5b6470",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 6,
              top: 2,
              width: 12,
              height: 16,
              borderRadius: 2,
              background: "#e6ebf2",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
