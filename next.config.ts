import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Landing pages are served from this app and embedded in the analytics
  // heatmap iframe on the same origin, so no frame headers are needed.
  images: { unoptimized: true },

  // Prisma ships a native query engine binary. Bundling the client inlines the
  // JS and leaves the .node file behind, so the deployed function cannot find
  // its engine. Keeping both packages external makes the bundler treat them as
  // real files on disk and carry the binary along with them.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
