import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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

/**
 * Sentry build-time integration. Attaches source maps to the Sentry
 * dashboard so stack traces resolve to real filenames + line numbers
 * instead of the minified production bundle. All sub-options are
 * failure-tolerant: when SENTRY_AUTH_TOKEN is unset locally, the
 * source-map upload step is skipped silently and the build still
 * succeeds. SENTRY_ORG + SENTRY_PROJECT are only required when
 * uploading source maps — unset = no upload, no error.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Suppress the chatty Sentry CLI logs during normal builds; CI gets
  // the full output.
  silent: !process.env.CI,
  // Upload a broader set of client bundles so React component stack
  // frames resolve cleanly.
  widenClientFileUpload: true,
  // Upload source maps to Sentry, then remove them from the public
  // bundle so they don't leak to anyone inspecting the production
  // site. Replaces the older hideSourceMaps option (v10 renamed it).
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Strip Sentry's own console logs from the production bundle.
  disableLogger: true,
  // We don't want Sentry's extra Vercel Cron monitors — we have our own.
  automaticVercelMonitors: false,
});
