import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow phone-on-WiFi testing against the dev server. Next.js 16 blocks
  // cross-origin dev resource requests by default; this whitelists the LAN.
  // Remove or tighten before production. Production builds aren't affected
  // by this setting.
  allowedDevOrigins: ["192.168.29.26", "*.local"],

  // The /api/admin/migrate handler reads prisma/schema.sql at runtime to
  // create the schema on a fresh Postgres database. Vercel bundles only files
  // Next.js can trace, so we force the inclusion of this asset.
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./prisma/schema.sql"],
  },
};

export default nextConfig;
