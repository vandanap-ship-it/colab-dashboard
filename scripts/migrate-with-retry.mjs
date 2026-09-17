#!/usr/bin/env node
// Prisma migrate deploy with retries.
//
// Vercel builds sometimes hit Prisma P1002 "database server was reached but
// timed out" on Neon — pg_advisory_lock contention with another pooled
// session. Prisma's default advisory-lock timeout is 10s and there's no
// flag to raise it, so instead we retry the whole `prisma migrate deploy`
// with 15s backoff. P1002 is transient; three attempts covers the common
// case where a stale pooled connection is holding the lock.
//
// Runs inline via `npm run build`. Exits 0 on any success, non-zero after
// three consecutive failures so Vercel still reports the real error.

import { spawn } from "node:child_process";

const MAX_ATTEMPTS = 3;
const BACKOFF_SECONDS = 15;

function run() {
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

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`\n[migrate-with-retry] attempt ${attempt}/${MAX_ATTEMPTS}`);
  const code = await run();
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
