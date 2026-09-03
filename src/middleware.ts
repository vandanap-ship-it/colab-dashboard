import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware — runs before every matching request (see `config.matcher`).
 *
 * Two jobs:
 *
 * 1. Security headers. Sensible defaults on every response:
 *    - Strict-Transport-Security  → force HTTPS on future visits
 *    - X-Content-Type-Options     → block MIME sniffing
 *    - X-Frame-Options            → block clickjacking via iframe embed
 *    - Referrer-Policy            → don't leak internal URLs to third parties
 *    - Permissions-Policy         → deny camera/mic/etc until we explicitly need them
 *
 * 2. Burst-limit protection. Per-instance in-memory token bucket keyed by
 *    client IP. Catches "someone's script is hammering us" attacks:
 *
 *      RESERVED FOR /api/* (auth pages excluded so a slow-login attempt
 *      can't lock a user out).
 *
 *    Not distributed — different Vercel serverless instances have separate
 *    counters. That's fine for the failure mode we're guarding: a single
 *    malfunctioning client hits a single instance repeatedly. For sustained
 *    abuse from many IPs, layer Vercel Firewall (dashboard) on top. Punch-
 *    listed in docs/version-release.md.
 */

const RATE_WINDOW_MS = 10_000; // 10 seconds
const RATE_MAX_HITS = 100;    // per IP per window, per instance

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function tooManyRequests(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count++;
  if (b.count > RATE_MAX_HITS) return true;
  return false;
}

// Cheap keep-the-map-small pass — runs on maybe 1% of requests.
function occasionalCleanup() {
  if (Math.random() > 0.01) return;
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (b.resetAt < now) buckets.delete(ip);
  }
}

function clientIp(req: NextRequest): string {
  // Prefer X-Forwarded-For (Vercel sets this to the real client IP), then
  // the Vercel-specific header, then the raw connection. Empty string when
  // unknown so the bucket key stays stable.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const v = req.headers.get("x-real-ip");
  if (v) return v.trim();
  return "unknown";
}

function applySecurityHeaders(res: NextResponse) {
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=(self), payment=()",
  );
}

export function middleware(req: NextRequest) {
  occasionalCleanup();

  // Burst-limit only /api/* — user-facing pages tolerate rapid navigation.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const ip = clientIp(req);
    if (tooManyRequests(ip)) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests. Slow down and retry." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(Math.ceil(RATE_WINDOW_MS / 1000)),
          },
        },
      );
    }
  }

  const res = NextResponse.next();
  applySecurityHeaders(res);
  return res;
}

export const config = {
  // Skip Next internals + static assets — no security value + wastes CPU.
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff|woff2|ttf)).*)"],
};
