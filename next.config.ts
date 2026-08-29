import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },

  // Prisma ships a native query engine binary. Bundling the client inlines the
  // JS and leaves the .node file behind, so the deployed function cannot find
  // its engine. Keeping both packages external makes the bundler treat them as
  // real files on disk and carry the binary along with them.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],

  /**
   * Baseline security headers.
   *
   * frame-ancestors rather than X-Frame-Options: DENY, because the analytics
   * heatmap renders a page inside an iframe on this same origin and a blanket
   * deny would blank it out. 'self' stops a stranger framing the sign-in page
   * over their own buttons while leaving the product's own embed working.
   *
   * No full Content-Security-Policy here. Published pages carry inline styles
   * and an inline tracker by design, so a real policy needs per-request nonces
   * threaded through the renderer. That is worth doing and is not a header
   * change; these four are the ones that cost nothing and were simply absent.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
