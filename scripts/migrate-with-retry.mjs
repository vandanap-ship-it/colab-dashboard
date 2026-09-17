#!/usr/bin/env node
// Prisma migrate deploy · Neon-safe launcher.
//
// Vercel builds have been failing with Prisma P1002 "server reached but
// timed out" while acquiring pg_advisory_lock(72707369) — Prisma's fixed
// 10s lock-acquisition timeout is smaller than Neon's cold-start window
// when the DB just auto-suspended, and if an earlier build crashed mid-
// migration on the *pooled* endpoint some pooled session can hold the
// lock long past its usefulness.
//
// This script:
//   1. Derives the *direct* (non-pooled) Neon URL by stripping `-pooler`
//      from the hostname. Advisory locks routed through PgBouncer land on
//      whichever pooled backend is up — they can't safely be released from
//      elsewhere. Direct connections dodge the pooler entirely and give
//      us the real pg_stat_activity view.
//   2. Warms up the direct connection so the DB is out of auto-suspend
//      before Prisma opens its own.
//   3. Force-terminates any session still holding advisory lock 72707369
//      (SELECT pg_terminate_backend(pid) ... FROM pg_locks WHERE ...).
//   4. Runs `prisma migrate deploy` with up to 3 attempts, 15s backoff.
//
// Non-Neon or DATABASE_URL without `-pooler`: steps 1-3 no-op cleanly and
// we go straight to migrate.

import { spawn } from "node:child_process";
import pg from "pg";

const MAX_ATTEMPTS = 3;
const BACKOFF_SECONDS = 15;
const PRISMA_MIGRATE_LOCK_ID = 72707369;

function deriveDirectUrl(pooledUrl) {
  if (!pooledUrl) return null;
  // Neon's convention: `ep-XXX-pooler.<region>.aws.neon.tech` is pooled;
  // dropping `-pooler` gives the direct endpoint. Leave URLs that don't
  // match this shape alone.
  if (!pooledUrl.includes("-pooler.")) return pooledUrl;
  return pooledUrl.replace("-pooler.", ".");
}

async function warmAndUnlock(directUrl) {
  const client = new pg.Client({
    connectionString: directUrl,
    // Small hard cap so a bad connection doesn't hang the whole build.
    connectionTimeoutMillis: 8_000,
    query_timeout: 8_000,
    statement_timeout: 8_000,
  });
  await client.connect();
  try {
    // Warm-up ping. On a freshly-woken Neon compute this can take a couple
    // of seconds; that's fine — the connection stays warm for the migrate.
    await client.query("SELECT 1");

    // Find any session currently holding our advisory lock, print who they
    // are for the build log, then terminate them. Neon reissues a fresh
    // backend on our next connection so a terminated stale session
    // doesn't cost anything real.
    const holders = await client.query(
      `SELECT a.pid, a.application_name, a.state, a.client_addr, a.xact_start
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.objid = $1`,
      [PRISMA_MIGRATE_LOCK_ID],
    );
    if (holders.rowCount > 0) {
      console.log(
        `[migrate-with-retry] found ${holders.rowCount} session(s) holding ` +
          `advisory lock ${PRISMA_MIGRATE_LOCK_ID}, terminating:`,
      );
      for (const r of holders.rows) {
        console.log(
          `  pid=${r.pid} app=${r.application_name} state=${r.state} ` +
            `client=${r.client_addr} xact_start=${r.xact_start}`,
        );
      }
      await client.query(
        `SELECT pg_terminate_backend(a.pid)
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND l.objid = $1
           AND a.pid <> pg_backend_pid()`,
        [PRISMA_MIGRATE_LOCK_ID],
      );
    } else {
      console.log(
        `[migrate-with-retry] no session holds advisory lock ${PRISMA_MIGRATE_LOCK_ID}`,
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

function runMigrate() {
  return new Promise((resolve) => {
    const child = spawn("npx", ["prisma", "migrate", "deploy"], {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

const pooled = process.env.DATABASE_URL;
const direct = deriveDirectUrl(pooled);
if (!pooled) {
  console.error("[migrate-with-retry] DATABASE_URL is not set");
  process.exit(1);
}
if (direct && direct !== pooled) {
  console.log("[migrate-with-retry] using direct (non-pooled) URL for warm-up + unlock");
} else {
  console.log("[migrate-with-retry] no -pooler suffix detected; using DATABASE_URL as-is");
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`\n[migrate-with-retry] attempt ${attempt}/${MAX_ATTEMPTS}`);
  try {
    await warmAndUnlock(direct);
  } catch (e) {
    // A warm-up failure is not fatal — we still let Prisma try. This keeps
    // the script safe against transient network hiccups and against Neon
    // configurations where the direct URL isn't reachable.
    console.warn(
      `[migrate-with-retry] warm-up/unlock failed: ${e?.message ?? e}. ` +
        "Proceeding with migrate anyway.",
    );
  }
  const code = await runMigrate();
  if (code === 0) {
    console.log("[migrate-with-retry] success");
    process.exit(0);
  }
  console.log(`[migrate-with-retry] exit ${code}`);
  if (attempt < MAX_ATTEMPTS) {
    console.log(`[migrate-with-retry] backing off ${BACKOFF_SECONDS}s`);
    await sleep(BACKOFF_SECONDS);
  }
}

console.error("[migrate-with-retry] all attempts failed");
process.exit(1);
