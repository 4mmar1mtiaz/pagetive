import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Landing pages are served from this app and embedded in the analytics
  // heatmap iframe on the same origin, so no frame headers are needed.
  images: { unoptimized: true },
};

export default nextConfig;
