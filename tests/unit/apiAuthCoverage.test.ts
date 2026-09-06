// CI guard for API auth coverage.
//
// Every API route MUST either:
//   - call auth() to gate on a session, OR
//   - be in EXEMPT_ROUTES with a documented reason.
//
// Adding a new route without auth() and without an exempt entry fails this
// test. When a new legitimate exemption comes up (e.g. a public health check),
// list it here with the reason — the test enforces documentation.
//
// This is the guard we should have had before "clear-test-data" and
// "cron/overdue-digest" landed with lazy auth.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const API_DIR = path.join(process.cwd(), "src/app/api");

/**
 * Routes that legitimately don't call auth(), with a reason. If you're adding
 * to this list, the reason must be defensible — token-based auth, public
 * endpoint by design, or a rewrite the framework owns.
 */
const EXEMPT_ROUTES: Record<string, string> = {
  "auth/[...nextauth]/route.ts":
    "NextAuth's own catch-all handler — IS the auth system, doesn't gate itself.",
  "admin/bootstrap/route.ts":
    "One-time bootstrap: gated by BOOTSTRAP_TOKEN env var (timing-safe compare) AND refuses once any user exists. Documented in the file.",
  "cron/overdue-digest/route.ts":
    "Vercel Cron endpoint: gated by CRON_SECRET Bearer token. Fails closed if the env var is missing.",
  "health/route.ts":
    "Intentional unauthenticated liveness probe for external uptime monitoring (UptimeRobot, StatusPage, etc.). Leaks nothing sensitive — only 'is app alive' + 'is DB reachable' + latency. Requires no-store to prevent stale cache responses.",
};

function collectRoutes(dir: string, relative = ""): string[] {
  const entries = readdirSync(dir);
  const routes: string[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    const rel = relative ? `${relative}/${name}` : name;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      routes.push(...collectRoutes(full, rel));
    } else if (name === "route.ts" || name === "route.tsx") {
      routes.push(rel);
    }
  }
  return routes;
}

describe("API auth coverage", () => {
  const routes = collectRoutes(API_DIR);

  it("finds a non-trivial number of API routes (guards the collector itself)", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it("every route either calls auth() or is explicitly exempt", () => {
    const violations: string[] = [];
    for (const rel of routes) {
      const full = path.join(API_DIR, rel);
      const source = readFileSync(full, "utf8");
      const callsAuth = /auth\s*\(\s*\)/.test(source);
      const exempt = rel in EXEMPT_ROUTES;
      if (!callsAuth && !exempt) {
        violations.push(rel);
      }
    }
    expect(violations, `Routes without auth() and not in EXEMPT_ROUTES: ${violations.join(", ")}`).toEqual([]);
  });

  it("exempt routes still exist (no dead entries)", () => {
    const dead: string[] = [];
    for (const rel of Object.keys(EXEMPT_ROUTES)) {
      if (!routes.includes(rel)) dead.push(rel);
    }
    expect(dead, `EXEMPT_ROUTES has entries for files that no longer exist: ${dead.join(", ")}`).toEqual([]);
  });
});
