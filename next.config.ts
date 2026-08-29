import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Landing pages are served from this app and embedded in the analytics
  // heatmap iframe on the same origin, so no frame headers are needed.
  images: { unoptimized: true },

  // Prisma's client is generated to src/generated/prisma, which the serverless
  // bundler does not trace on its own. Without this the query engine binary is
  // left out of the deployed function and every request fails at runtime.
  outputFileTracingIncludes: {
    "/**": ["./src/generated/prisma/**"],
  },
};

export default nextConfig;
