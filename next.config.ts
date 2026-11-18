import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows a separate build output dir (e.g. NEXT_DIST_DIR=.next-w1) so parallel dev/build runs don't collide.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  // Photo uploads (athlete / profile) go through server actions; phone photos exceed the 1 MB default.
  // The DAL still enforces MAX_PHOTO_UPLOAD_BYTES (8 MB) and validates content.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
