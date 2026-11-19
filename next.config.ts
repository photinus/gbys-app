import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows a separate build output dir (e.g. NEXT_DIST_DIR=.next-w1) so parallel dev/build runs don't collide.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  // Photo uploads (athlete / profile) go through server actions; phone photos exceed the 1 MB default.
  // The DAL still enforces MAX_PHOTO_UPLOAD_BYTES (8 MB) and validates content.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // Clickjacking protection: no page may be framed by another site, except the
  // public /embed/* pages, whose frame-ancestors allow-list is set at request
  // time by src/middleware.ts from EMBED_ALLOWED_ORIGINS.
  async headers() {
    return [
      {
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
