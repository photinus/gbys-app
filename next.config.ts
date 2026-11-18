import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows a separate build output dir (e.g. NEXT_DIST_DIR=.next-w1) so parallel dev/build runs don't collide.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
