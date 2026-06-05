/**
 * One-shot data migration: Turso (SQLite) → Neon (Postgres).
 *
 * Run this AFTER:
 *   1. You've cut Vercel over to Neon's DATABASE_URL
 *   2. You've hit POST /api/admin/migrate (or `prisma db push`) to create the
 *      schema on Neon
 *   3. Neon is empty (no rows in any table — script refuses otherwise unless
 *      --force is passed)
 *
 * Usage (from project root):
 *
 *   TURSO_DATABASE_URL="libsql://..." \
 *   TURSO_AUTH_TOKEN="eyJ..." \
 *   NEON_DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/migrate-turso-to-neon.ts --dry-run
 *
 *   # If dry-run row counts look right:
 *   npx tsx scripts/migrate-turso-to-neon.ts
 *
 *   # To overwrite a non-empty Neon (DANGEROUS — deletes Neon rows first):
 *   npx tsx scripts/migrate-turso-to-neon.ts --force
 *
 * How it works:
 *   - Turso side: the raw @libsql/client (Prisma 7 won't let a single
 *     PrismaClient serve both SQLite *and* Postgres, so we drop down to plain
 *     SQL for reads). One SELECT * per table, batched insert into Neon.
 *   - Neon side: Prisma + PrismaPg, so writes go through the same
 *     soft-delete-aware, type-correct path the live app uses.
 *   - Type fixups per row before insert:
 *       Boolean fields: SQLite stores INTEGER 0/1 → coerce to true/false
 *       DateTime fields: SQLite stores ISO TEXT → wrap in new Date(...)
 *       Other scalars (String, Int, Float) pass through verbatim.
 *   - WBSNode has a self-FK on parentId, so its rows are pre-sorted so parents
 *     come before children inside the createMany batch.
 *   - Inserts are batched at 500 rows/call to stay under Postgres parameter
 *     limits.
 *
 * What it does NOT touch:
 *   - The _AdminMigration ledger (Neon's already has the Postgres baseline
 *     entry from /api/admin/migrate; Turso's SQLite migration keys don't apply)
 *   - File contents in Vercel Blob (URLs stay the same; the blobs themselves
 *     don't move)
 */
import { createClient as createLibSqlClient } from "@libsql/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuth = process.env.TURSO_AUTH_TOKEN;
const neonUrl = process.env.NEON_DATABASE_URL;
if (!tursoUrl) throw new Error("TURSO_DATABASE_URL is required");
if (!tursoAuth) throw new Error("TURSO_AUTH_TOKEN is required");
if (!neonUrl) throw new Error("NEON_DATABASE_URL is required");

const turso = createLibSqlClient({ url: tursoUrl, authToken: tursoAuth });
const neon = new PrismaClient({
  adapter: new PrismaPg({ connectionString: neonUrl }),
});

/**
 * One row per table in topological FK order. Parents first; children later.
 *   - `accessor`  = camelCased Prisma client property (e.g. `wBSNode`)
 *   - `table`     = the actual SQL table name in both engines
 *   - `booleans`  = field names that SQLite stores as INTEGER 0/1 and Postgres
 *                   expects as boolean
 *   - `dates`     = field names that SQLite stores as TEXT (ISO) and Postgres
 *                   expects as a Date instance
 */
type TableSpec = {
  accessor: string;
  table: string;
  booleans?: string[];
  dates?: string[];
};

const TABLES: TableSpec[] = [
  { accessor: "user", table: "User", booleans: ["active"], dates: ["createdAt", "updatedAt"] },
  {
    accessor: "project", table: "Project",
    dates: ["startDate", "endDate", "actualStartDate", "projectedEndDate", "reraEndDate", "createdAt", "updatedAt"],
  },
  { accessor: "contractor", table: "Contractor", booleans: ["active"], dates: ["createdAt"] },
  {
    accessor: "wBSNode", table: "WBSNode",
    booleans: ["progressEntered"],
    dates: ["baselineStart", "baselineFinish", "actualStart", "actualFinish", "projectedFinish", "createdAt", "updatedAt"],
  },
  {
    accessor: "progressEntry", table: "ProgressEntry",
    dates: ["date", "createdAt", "updatedAt", "deletedAt"],
  },
  { accessor: "progressLabour", table: "ProgressLabour" },
  { accessor: "progressPhoto", table: "ProgressPhoto", dates: ["uploadedAt"] },
  {
    accessor: "hindrance", table: "Hindrance",
    dates: ["startDate", "resolvedDate", "createdAt", "updatedAt", "deletedAt"],
  },
  { accessor: "hindrancePhoto", table: "HindrancePhoto", dates: ["uploadedAt"] },
  { accessor: "concern", table: "Concern", dates: ["createdAt", "updatedAt", "deletedAt"] },
  { accessor: "concernPhoto", table: "ConcernPhoto", dates: ["uploadedAt"] },
  { accessor: "issue", table: "Issue", dates: ["createdAt", "updatedAt", "deletedAt"] },
  { accessor: "issuePhoto", table: "IssuePhoto", dates: ["uploadedAt"] },
  {
    accessor: "inspection", table: "Inspection",
    dates: ["createdAt", "updatedAt", "deletedAt", "reviewedAt"],
  },
  { accessor: "inspectionItem", table: "InspectionItem", booleans: ["passed"] },
  { accessor: "inspectionPhoto", table: "InspectionPhoto", dates: ["uploadedAt"] },
  {
    accessor: "projectDrawing", table: "ProjectDrawing",
    booleans: ["isDefault"], dates: ["createdAt"],
  },
  {
    accessor: "inspectionTemplate", table: "InspectionTemplate",
    booleans: ["active"], dates: ["createdAt", "updatedAt"],
  },
  { accessor: "inspectionTemplateItem", table: "InspectionTemplateItem" },
  { accessor: "auditLog", table: "AuditLog", dates: ["createdAt"] },
  {
    accessor: "subContractorBill", table: "SubContractorBill",
    dates: ["periodStart", "periodEnd", "submittedAt", "approvedAt", "createdAt", "updatedAt", "deletedAt"],
  },
  { accessor: "subContractorBillLine", table: "SubContractorBillLine" },
  {
    accessor: "expense", table: "Expense",
    dates: ["date", "approvedAt", "createdAt", "updatedAt", "deletedAt"],
  },
  { accessor: "expensePhoto", table: "ExpensePhoto", dates: ["uploadedAt"] },
  {
    accessor: "designDrawing", table: "DesignDrawing",
    dates: ["createdAt", "updatedAt", "deletedAt"],
  },
  {
    accessor: "designDrawingRevision", table: "DesignDrawingRevision",
    dates: ["issuedDate", "uploadedAt"],
  },
];

/** Sort WBSNode rows so any row's parent appears before the row itself. */
function topoSortByParent<T extends { id: string; parentId: string | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const out: T[] = [];
  function visit(r: T) {
    if (visited.has(r.id)) return;
    if (r.parentId && byId.has(r.parentId)) visit(byId.get(r.parentId)!);
    visited.add(r.id);
    out.push(r);
  }
  rows.forEach(visit);
  return out;
}

/** Fix up one Turso row for the Postgres insert. */
function transformRow(
  raw: Record<string, unknown>,
  booleans: Set<string>,
  dates: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    if (booleans.has(k)) {
      // libsql returns BigInt or number for INTEGER columns; both coerce sanely.
      out[k] = Number(v) !== 0;
      continue;
    }
    if (dates.has(k)) {
      // libsql returns TEXT for ISO timestamps Prisma wrote.
      out[k] = typeof v === "string" ? new Date(v) : v instanceof Date ? v : new Date(String(v));
      continue;
    }
    // BigInt → number for IDs / counts. Prisma's PG adapter accepts both, but
    // mixing BigInts with `createMany` has bitten us before.
    if (typeof v === "bigint") {
      out[k] = Number(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

const BATCH = 500;

async function copyTable(spec: TableSpec): Promise<{ source: number; copied: number }> {
  const booleans = new Set(spec.booleans ?? []);
  const dates = new Set(spec.dates ?? []);

  // Read everything from Turso. Tables we expect on every prod DB; if one is
  // missing (e.g. you're running this against an older Turso branch), the
  // catch below treats it as zero rows so the script keeps going.
  let raw: Array<Record<string, unknown>>;
  try {
    const result = await turso.execute(`SELECT * FROM "${spec.table}"`);
    raw = result.rows as unknown as Array<Record<string, unknown>>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table/i.test(msg)) {
      console.log(` (table absent on Turso — skipping)`);
      return { source: 0, copied: 0 };
    }
    throw e;
  }

  let rows = raw.map((r) => transformRow(r, booleans, dates));
  const sourceCount = rows.length;

  if (spec.table === "WBSNode") {
    rows = topoSortByParent(rows as Array<{ id: string; parentId: string | null }>);
  }

  if (DRY_RUN || sourceCount === 0) return { source: sourceCount, copied: 0 };

  const neonModel = (neon as unknown as Record<string, {
    createMany: (args: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => Promise<{ count: number }>;
  }>)[spec.accessor];

  let copied = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = await neonModel.createMany({ data: batch, skipDuplicates: true });
    copied += result.count;
  }
  return { source: sourceCount, copied };
}

async function neonIsEmpty(): Promise<{ empty: boolean; populated: string[] }> {
  const populated: string[] = [];
  for (const spec of TABLES) {
    const count = await (neon as unknown as Record<string, { count: () => Promise<number> }>)[spec.accessor].count();
    if (count > 0) populated.push(`${spec.table}(${count})`);
  }
  return { empty: populated.length === 0, populated };
}

async function truncateAll() {
  // Truncate in REVERSE FK order; CASCADE keeps it simple if FKs cross
  // unexpected boundaries.
  for (const spec of [...TABLES].reverse()) {
    await neon.$executeRawUnsafe(`TRUNCATE TABLE "${spec.table}" RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  console.log("================================================================");
  console.log(DRY_RUN ? "  DRY RUN — no writes to Neon" : "  LIVE MIGRATION");
  console.log("  Source: Turso  →  Target: Neon");
  console.log("================================================================");
  console.log();

  if (!DRY_RUN) {
    const { empty, populated } = await neonIsEmpty();
    if (!empty && !FORCE) {
      console.error("Neon is not empty:");
      populated.forEach((p) => console.error(`  - ${p}`));
      console.error();
      console.error("Refusing to overwrite. Re-run with --force to TRUNCATE Neon first.");
      process.exit(2);
    }
    if (!empty && FORCE) {
      console.log("--force: truncating Neon tables...");
      await truncateAll();
      console.log("  Neon truncated.");
      console.log();
    }
  }

  const results: Array<{ table: string; accessor: string; source: number; copied: number }> = [];
  for (const spec of TABLES) {
    process.stdout.write(`  ${spec.table.padEnd(28)} `);
    const { source, copied } = await copyTable(spec);
    console.log(DRY_RUN ? `${source} rows in Turso` : `${source} → ${copied} copied`);
    results.push({ table: spec.table, accessor: spec.accessor, source, copied });
  }

  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN complete. No changes made.");
    console.log("Re-run without --dry-run to perform the migration.");
    return;
  }

  console.log("Verifying row counts...");
  let mismatches = 0;
  for (const r of results) {
    const neonCount = await (neon as unknown as Record<string, { count: () => Promise<number> }>)[r.accessor].count();
    const ok = neonCount === r.source;
    if (!ok) {
      console.log(`  ${r.table.padEnd(28)} Turso=${r.source}  Neon=${neonCount}  MISMATCH`);
      mismatches++;
    } else {
      console.log(`  ${r.table.padEnd(28)} ${neonCount} ok`);
    }
  }

  console.log();
  if (mismatches > 0) {
    console.error(`FAILED: ${mismatches} table(s) have mismatched counts. Investigate before going live.`);
    process.exit(1);
  }
  console.log("All row counts match. Migration complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await neon.$disconnect();
    turso.close();
  });
