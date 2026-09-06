/**
 * Prod smoke test. Run AFTER the Neon cutover (env flipped, schema applied,
 * data copied) to verify the live deployment is healthy end-to-end:
 *
 *   1. NextAuth credentials login flow works (auth + Prisma user read)
 *   2. Admin migrate ledger reports the Postgres baseline as applied
 *   3. Core list endpoints return non-error responses
 *   4. Per-project, drawings/wbs/inspections/bills/expenses are queryable
 *
 * Usage:
 *
 *   PROD_BASE_URL="https://siddhi.example.com" \
 *   ADMIN_USERNAME="admin" \
 *   ADMIN_PASSWORD="..." \
 *   npx tsx scripts/smoke-prod.ts
 *
 * Exit code 0 = all checks passed. Non-zero = at least one check failed (and
 * stdout shows which). Designed to be safe to re-run; only reads, never writes.
 *
 * Why a custom HTTP client instead of Playwright? This is a post-deploy health
 * check that should run from any machine in under a few seconds without a
 * browser install. Playwright lives in tests/e2e for full UI coverage.
 */

const BASE = (process.env.PROD_BASE_URL ?? "").replace(/\/$/, "");
const USERNAME = process.env.ADMIN_USERNAME ?? "";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";

if (!BASE) throw new Error("PROD_BASE_URL is required (e.g. https://siddhi.vercel.app)");
if (!USERNAME) throw new Error("ADMIN_USERNAME is required");
if (!PASSWORD) throw new Error("ADMIN_PASSWORD is required");

/**
 * Tiny cookie jar. Node's `fetch` doesn't track cookies across requests, so we
 * stash every Set-Cookie we see and replay them on every subsequent call.
 *
 * We don't parse attributes (Path, HttpOnly, etc.) because we're talking to
 * exactly one origin for the duration of the run — the name/value pair is all
 * we need to send back as a Cookie header.
 */
class CookieJar {
  private cookies = new Map<string, string>();
  ingest(headers: Headers) {
    // getSetCookie() returns each Set-Cookie header separately (since Node 20).
    const setCookies =
      typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === "" || value === "deleted") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

const jar = new CookieJar();

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${BASE}${path}`;
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.ingest(res.headers);
  return res;
}

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name.padEnd(58)}`);
  try {
    await fn();
    console.log("ok");
    passed++;
  } catch (e) {
    console.log("FAIL");
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

/** NextAuth v5 credentials login. Mirrors what the /login page does in-browser. */
async function login() {
  // 1. CSRF — server sets `*authjs.csrf-token` cookie + returns the token.
  const csrfRes = await req("/api/auth/csrf");
  if (!csrfRes.ok) throw new Error(`CSRF endpoint returned ${csrfRes.status}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  if (!csrfToken) throw new Error("No csrfToken in /api/auth/csrf response");

  // 2. POST credentials. NextAuth expects form-urlencoded with the token,
  //    username, password, and a callbackUrl. With `json=true` it returns JSON
  //    instead of redirecting, which is friendlier for a script.
  const body = new URLSearchParams({
    csrfToken,
    username: USERNAME,
    password: PASSWORD,
    callbackUrl: `${BASE}/`,
    json: "true",
  });
  const loginRes = await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (loginRes.status >= 400) {
    throw new Error(`Credentials POST returned ${loginRes.status}`);
  }
  // NextAuth signals invalid credentials by sending the user back to the login
  // page (?error=...). A successful login sets a session cookie.
  const sessionRes = await req("/api/auth/session");
  const session = (await sessionRes.json()) as { user?: { role?: string; username?: string } };
  if (!session?.user?.username) {
    throw new Error("Session endpoint reports no logged-in user — credentials likely wrong");
  }
  if (session.user.username !== USERNAME) {
    throw new Error(`Session belongs to "${session.user.username}", expected "${USERNAME}"`);
  }
  if (session.user.role !== "ADMIN") {
    throw new Error(`Admin smoke test requires ADMIN role; this user is ${session.user.role}`);
  }
}

type ProjectRow = { id: string; name: string; status: string };

async function listProjects(): Promise<ProjectRow[]> {
  const res = await req("/api/projects");
  if (!res.ok) throw new Error(`GET /api/projects returned ${res.status}`);
  const json = (await res.json()) as { projects?: ProjectRow[] };
  if (!Array.isArray(json.projects)) throw new Error("response.projects is not an array");
  return json.projects;
}

async function expectOk(path: string, label: string) {
  const res = await req(path);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  // Parse JSON to catch HTML error pages disguised as 200s.
  try {
    await res.clone().json();
  } catch {
    throw new Error(`GET ${path} → 200 but body wasn't JSON (${label})`);
  }
}

async function main() {
  console.log("================================================================");
  console.log(`  PROD SMOKE — ${BASE}`);
  console.log("================================================================");
  console.log();

  console.log("Auth + admin checks");
  await check("login as admin via credentials", login);
  await check("GET /api/admin/migrate (admin-only, schema ledger)", async () => {
    const res = await req("/api/admin/migrate");
    if (!res.ok) throw new Error(`returned ${res.status}`);
    const json = (await res.json()) as { migrations?: Array<{ key: string; status: string }> };
    if (!json.migrations?.length) throw new Error("no migrations reported");
    const baseline = json.migrations.find((m) => m.key === "2026-06-04_postgres_baseline");
    if (!baseline) throw new Error("baseline migration not in ledger");
    if (baseline.status !== "applied") throw new Error(`baseline status is "${baseline.status}", expected "applied"`);
  });

  console.log();
  console.log("Top-level list endpoints");
  let projects: ProjectRow[] = [];
  await check("GET /api/projects", async () => {
    projects = await listProjects();
    if (projects.length === 0) {
      throw new Error("zero projects returned — data migration may not have run");
    }
  });
  await check("GET /api/projects/summary", () => expectOk("/api/projects/summary", "summary"));
  await check("GET /api/users", () => expectOk("/api/users", "users"));
  await check("GET /api/my-actions", () => expectOk("/api/my-actions", "my-actions"));

  console.log();
  console.log(`Per-project endpoints (${projects.length} project${projects.length === 1 ? "" : "s"})`);
  for (const p of projects) {
    console.log(`  · ${p.name} (${p.status})`);
    await check(`    GET /api/projects/${p.id}`, () => expectOk(`/api/projects/${p.id}`, "project detail"));
    await check(`    GET /api/projects/${p.id}/wbs`, () => expectOk(`/api/projects/${p.id}/wbs`, "wbs"));
    await check(`    GET /api/projects/${p.id}/insights`, () => expectOk(`/api/projects/${p.id}/insights`, "insights"));
    await check(`    GET /api/projects/${p.id}/drawings`, () => expectOk(`/api/projects/${p.id}/drawings`, "drawings"));
    await check(`    GET /api/inspections?projectId=${p.id}`, () =>
      expectOk(`/api/inspections?projectId=${p.id}`, "inspections"),
    );
    await check(`    GET /api/bills?projectId=${p.id}`, () =>
      expectOk(`/api/bills?projectId=${p.id}`, "bills"),
    );
    await check(`    GET /api/expenses?projectId=${p.id}`, () =>
      expectOk(`/api/expenses?projectId=${p.id}`, "expenses"),
    );
    await check(`    GET /api/concerns?projectId=${p.id}`, () =>
      expectOk(`/api/concerns?projectId=${p.id}`, "concerns"),
    );
    await check(`    GET /api/issues?projectId=${p.id}`, () =>
      expectOk(`/api/issues?projectId=${p.id}`, "issues"),
    );
    await check(`    GET /api/hindrances?projectId=${p.id}`, () =>
      expectOk(`/api/hindrances?projectId=${p.id}`, "hindrances"),
    );
    // Modules the earlier smoke run didn't cover — RFI, Permit,
    // ManpowerEntry, TradePlan. All are gated by canAccessModule +
    // per-project tenancy, so a regression in either would surface here
    // as a 403 for the admin (which is unexpected — admin passes every
    // module gate).
    await check(`    GET /api/rfi?projectId=${p.id}`, () =>
      expectOk(`/api/rfi?projectId=${p.id}`, "rfi"),
    );
    await check(`    GET /api/permits?projectId=${p.id}`, () =>
      expectOk(`/api/permits?projectId=${p.id}`, "permits"),
    );
    await check(`    GET /api/manpower-entries?projectId=${p.id}`, () =>
      expectOk(`/api/manpower-entries?projectId=${p.id}`, "manpower-entries"),
    );
    await check(`    GET /api/projects/${p.id}/trade-plans`, () =>
      expectOk(`/api/projects/${p.id}/trade-plans`, "trade-plans"),
    );
  }

  console.log();
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
