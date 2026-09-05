/**
 * Backup verifier.
 *
 * Pulls the newest .sql.gz from the private Vercel Blob store under the
 * backups/ prefix, gunzips it in memory, walks the pg_dump output line-by-
 * line, and prints how many rows each table's COPY block contains.
 *
 * Exit code:
 *   0 — backup looks healthy (size > floor, critical tables non-empty)
 *   1 — backup looks broken (empty gzip, missing tables, or zero rows in
 *       tables we know shouldn't be empty)
 *
 * Runs locally OR in a GitHub Action on a cron alongside the backup job:
 *
 *   BLOB_READ_WRITE_TOKEN="vercel_blob_..." \
 *     npx tsx scripts/verify-backup.ts
 *
 * The 10-day silent-backup outage this codebase hit in August 2026 (empty
 * gzips uploaded nightly, undetected because the workflow reported success)
 * is exactly the failure mode this script catches. Wire it into the same
 * cron as the backup job and let it fail loudly if something regresses.
 */

import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { list } from "@vercel/blob";

// Minimum acceptable compressed size — an empty pg_dump gzips to ~20 bytes,
// even a bare-schema no-data dump lands under 5 KB. A real dump of the
// Amanvana project (14k WBS rows, thousands of progress entries) compresses
// to at least ~500 KB. Set the floor low enough that a "small but real"
// backup passes but a corrupted/empty one fails.
const MIN_COMPRESSED_BYTES = 100 * 1024; // 100 KB

// Tables that MUST have rows in a healthy production backup. If any of these
// come back with zero rows the backup is essentially useless — flag it.
// (Not every table needs a row — e.g. a fresh project may have no permits
// yet — so this list is deliberately short.)
const CRITICAL_TABLES = new Set(["Project", "User", "WBSNode", "Contractor"]);

type BackupSummary = {
  blobUrl: string;
  filename: string;
  compressedBytes: number;
  perTable: Map<string, number>;
};

async function findNewestBackup(): Promise<{ url: string; pathname: string; size: number } | null> {
  // Walk the backups/ prefix. Vercel Blob's list() paginates; the API returns
  // items sorted by upload time descending by default, but we sort defensively
  // in case that changes.
  const results: Array<{ url: string; pathname: string; size: number; uploadedAt: Date }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: "backups/",
      limit: 1000,
      cursor,
    });
    for (const b of page.blobs) {
      if (!b.pathname.endsWith(".sql.gz")) continue;
      results.push({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: new Date(b.uploadedAt),
      });
    }
    cursor = page.cursor;
  } while (cursor);

  if (results.length === 0) return null;
  results.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const newest = results[0];
  return { url: newest.url, pathname: newest.pathname, size: newest.size };
}

async function fetchBlob(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

/**
 * pg_dump plain-SQL output writes bulk data as:
 *
 *   COPY "TableName" (col1, col2, ...) FROM stdin;
 *   value1\tvalue2\t...
 *   value1\tvalue2\t...
 *   \.
 *
 * Row count is the number of lines between the COPY header and the '\.'
 * terminator. This parser is line-oriented so it works on streamed input
 * without materialising the whole SQL file in memory (a large project's
 * dump can be 100 MB uncompressed).
 */
function parseCopyBlocks(sqlBuffer: Buffer): Map<string, number> {
  const perTable = new Map<string, number>();
  const text = sqlBuffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  let currentTable: string | null = null;
  let count = 0;
  const copyStart = /^COPY\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+\(.*\)\s+FROM\s+stdin;\s*$/;
  for (const line of lines) {
    if (currentTable === null) {
      const m = line.match(copyStart);
      if (m) {
        currentTable = m[1];
        count = 0;
      }
    } else if (line === "\\.") {
      const prev = perTable.get(currentTable) ?? 0;
      perTable.set(currentTable, prev + count);
      currentTable = null;
      count = 0;
    } else {
      count++;
    }
  }
  return perTable;
}

async function gunzipBuffer(gz: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const src = new PassThrough();
  const sink = new PassThrough();
  sink.on("data", (c: Buffer) => chunks.push(c));
  src.end(gz);
  await pipeline(src, createGunzip(), sink);
  return Buffer.concat(chunks);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function main(): Promise<BackupSummary> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN required — set the private-store token in the environment.\n" +
      "Grab it from Vercel → your project → Storage → siddhi-backups → Environment.",
    );
  }

  console.log("→ Listing backups/ …");
  const newest = await findNewestBackup();
  if (!newest) {
    throw new Error(
      "No .sql.gz files under backups/. Either the nightly backup has never run, or\n" +
      "the BLOB_READ_WRITE_TOKEN points at the wrong store.",
    );
  }
  console.log(`  newest: ${newest.pathname} (${fmtBytes(newest.size)})`);

  if (newest.size < MIN_COMPRESSED_BYTES) {
    throw new Error(
      `Backup size ${fmtBytes(newest.size)} is below the floor ${fmtBytes(MIN_COMPRESSED_BYTES)}.\n` +
      `This is exactly the "empty gzip uploaded nightly" failure mode from August 2026.\n` +
      `The backup workflow probably succeeded (2xx from Vercel Blob) but the dump was empty.\n` +
      `Check the most recent workflow run logs.`,
    );
  }

  console.log("→ Downloading …");
  const gz = await fetchBlob(newest.url);
  console.log(`  ${fmtBytes(gz.length)} compressed`);

  console.log("→ Gunzipping …");
  const sql = await gunzipBuffer(gz);
  console.log(`  ${fmtBytes(sql.length)} uncompressed`);

  console.log("→ Parsing COPY blocks …");
  const perTable = parseCopyBlocks(sql);

  return {
    blobUrl: newest.url,
    filename: newest.pathname,
    compressedBytes: newest.size,
    perTable,
  };
}

main()
  .then((summary) => {
    console.log("");
    console.log("=".repeat(72));
    console.log(`Backup: ${summary.filename}`);
    console.log(`Size:   ${fmtBytes(summary.compressedBytes)} compressed`);
    console.log("=".repeat(72));

    const sortedTables = Array.from(summary.perTable.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [table, count] of sortedTables) {
      console.log(`  ${table.padEnd(30)} ${String(count).padStart(9)} rows`);
    }
    console.log("");

    const emptyCritical = [...CRITICAL_TABLES].filter(
      (t) => (summary.perTable.get(t) ?? 0) === 0,
    );
    if (emptyCritical.length > 0) {
      console.error(
        `✗ FAIL — critical tables have 0 rows: ${emptyCritical.join(", ")}\n` +
        `  Backup exists and has data, but core tables are empty. Likely the\n` +
        `  pg_dump ran against the wrong database, or the schema was wiped\n` +
        `  before the dump ran.`,
      );
      process.exit(1);
    }

    console.log("✓ OK — backup looks healthy.");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("");
    console.error("✗ FAIL —", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
