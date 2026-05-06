import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow phone-on-WiFi testing against the dev server. Next.js 16 blocks
  // cross-origin dev resource requests by default; this whitelists the LAN.
  // Remove or tighten before production — production builds aren't affected
  // by this setting.
  allowedDevOrigins: ["192.168.29.26", "*.local"],
};

export default nextConfig;
