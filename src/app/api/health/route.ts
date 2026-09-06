import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public health check for external uptime monitoring (UptimeRobot,
 * StatusPage, Better Uptime, or a Vercel Cron warm-up ping).
 *
 * Unauthenticated on purpose — the whole point is that a third-party
 * probe can hit it without credentials to verify Siddhi is up. The
 * response leaks nothing sensitive: only "does the app respond" and
 * "is the DB connection alive", with a wall-clock round-trip time
 * so a monitor can alert on regression.
 *
 * Returns 200 when both the function boot and the DB round-trip
 * succeed, 503 otherwise — that's the industry convention for
 * "the server is alive but a dependency is down", which lets a
 * monitor distinguish "app crashed" (no response) from "DB down"
 * (503 with details) from "healthy" (200).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  // SELECT 1 is the cheapest possible DB round-trip — no tables touched,
  // no rows read, just a "is the pool alive" signal. Neon's cold-start
  // routes will pay their own wake-up cost the first time this fires
  // after idle; subsequent hits within a few minutes are sub-100ms.
  let dbConnected = false;
  let dbLatencyMs: number | null = null;
  let dbError: string | null = null;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "unknown";
  }

  const totalMs = Date.now() - started;
  const body = {
    ok: dbConnected,
    // ISO in UTC — machine-parseable, no locale concerns.
    checkedAt: new Date().toISOString(),
    totalMs,
    db: {
      connected: dbConnected,
      latencyMs: dbLatencyMs,
      // Only include error text when the check failed; success responses
      // are minimal so a monitor's log volume doesn't balloon.
      ...(dbError ? { error: dbError } : {}),
    },
  };

  return NextResponse.json(body, {
    status: dbConnected ? 200 : 503,
    // Keep intermediaries from caching a health check — a stale "healthy"
    // response is the worst possible outcome for a monitoring endpoint.
    headers: { "cache-control": "no-store" },
  });
}
