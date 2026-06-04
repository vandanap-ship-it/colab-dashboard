/**
 * One-shot data migration: Turso (SQLite) → Neon (Postgres).
 *
 * Run this AFTER:
 *   1. You've cut Vercel over to Neon's DATABASE_URL
 *   2. You've hit POST /api/admin/migrate to create the schema on Neon
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
 * What it does:
 *   - Connects to Turso via the libsql adapter and Neon via the pg adapter.
 *     Both clients are built RAW (no soft-delete extension), so we see + copy
 *     soft-deleted rows verbatim.
 *   - Walks the models in topological FK order, reading every row from Turso
 *     and inserting into Neon with createMany({ skipDuplicates: true }).
 *   - WBSNode has a self-FK on parentId, so its rows are pre-sorted so parents
 *     come before children inside the createMany batch.
 *   - Batches inserts in groups of 500 to stay under Postgres parameter limits.
 *   - Prints row counts per table from both sides at the end and exits
 *     non-zero if any mismatch.
 *
 * What it does NOT touch:
 *   - The _AdminMigration ledger (you've already applied the Postgres baseline,
 *     so Neon's ledger should reflect that, not Turso's SQLite migration keys)
 *   - File contents in Vercel Blob (the BlobPathnames in ProgressPhoto etc.
 *     stay the same — the blobs themselves don't move)
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaPg } from "@prisma/adapter-pg";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoAuth = process.env.TURSO_AUTH_TOKEN;
const neonUrl = process.env.NEON_DATABASE_URL;
if (!tursoUrl) throw new Error("TURSO_DATABASE_URL is required");
if (!tursoAuth) throw new Error("TURSO_AUTH_TOKEN is required");
if (!neonUrl) throw new Error("NEON_DATABASE_URL is required");

const turso = new PrismaClient({
  adapter: new PrismaLibSql({ url: tursoUrl, authToken: tursoAuth }),
});
const neon = new PrismaClient({
  adapter: new PrismaPg({ connectionString: neonUrl }),
});

/**
 * Models in topological FK order. Parents first; children later. We don't use
 * Prisma's DMMF here because the order changes rarely and being explicit makes
 * the script easier to reason about during the one-time cutover.
 *
 * The string is the Prisma client accessor (camelCased model name).
 */
const MODEL_ORDER = [
  "user",
  "project",
  "contractor",
  "wBSNode",                 // self-FK, pre-sorted inside copyTable
  "progressEntry",
  "progressLabour",
  "progressPhoto",
  "hindrance",
  "hindrancePhoto",
  "concern",
  "concernPhoto",
  "issue",
  "issuePhoto",
  "inspection",
  "inspectionItem",
  "inspectionPhoto",
  "projectDrawing",
  "inspectionTemplate",
  "inspectionTemplateItem",
  "auditLog",
  "subContractorBill",
  "subContractorBillLine",
  "expense",
  "expensePhoto",
  "designDrawing",
  "designDrawingRevision",
] as const;

type ModelKey = (typeof MODEL_ORDER)[number];

/** Sort WBSNode rows so any row's parent appears before the row itself. */
function topoSortByParent(rows: Array<{ id: string; parentId: string | null }>) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const out: typeof rows = [];
  function visit(r: (typeof rows)[number]) {
    if (visited.has(r.id)) return;
    if (r.parentId && byId.has(r.parentId)) visit(byId.get(r.parentId)!);
    visited.add(r.id);
    out.push(r);
  }
  rows.forEach(visit);
  return out;
}

const BATCH = 500;

async function copyTable(model: ModelKey): Promise<{ source: number; copied: number }> {
  // Dynamic model access — `model` is constrained by the union above so this is
  // safe at runtime. The cast tells TS the shape we actually call.
  const tursoModel = (turso as unknown as Record<ModelKey, {
    findMany: (args?: object) => Promise<Array<Record<string, unknown>>>;
  }>)[model];
  const neonModel = (neon as unknown as Record<ModelKey, {
    createMany: (args: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => Promise<{ count: number }>;
    count: (args?: object) => Promise<number>;
  }>)[model];

  let rows = await tursoModel.findMany();
  const sourceCount = rows.length;

  if (model === "wBSNode") {
    rows = topoSortByParent(rows as Array<{ id: string; parentId: string | null }>);
  }

  if (DRY_RUN || sourceCount === 0) {
    return { source: sourceCount, copied: 0 };
  }

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
  for (const model of MODEL_ORDER) {
    const count = await (neon as unknown as Record<ModelKey, { count: () => Promise<number> }>)[model].count();
    if (count > 0) populated.push(`${model}(${count})`);
  }
  return { empty: populated.length === 0, populated };
}

async function truncateAll() {
  // Truncate in REVERSE FK order so we don't trip referential checks.
  // CASCADE keeps it simple if FKs cross unexpected boundaries.
  for (const model of [...MODEL_ORDER].reverse()) {
    const table = model[0].toUpperCase() + model.slice(1);
    await neon.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
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

  const results: Array<{ model: string; source: number; copied: number }> = [];
  for (const model of MODEL_ORDER) {
    process.stdout.write(`  ${model.padEnd(28)} `);
    const { source, copied } = await copyTable(model);
    console.log(DRY_RUN ? `${source} rows in Turso` : `${source} → ${copied} copied`);
    results.push({ model, source, copied });
  }

  console.log();

  if (DRY_RUN) {
    console.log("DRY RUN complete. No changes made.");
    console.log("Re-run without --dry-run to perform the migration.");
    return;
  }

  // Verify Neon counts match Turso counts.
  console.log("Verifying row counts...");
  let mismatches = 0;
  for (const r of results) {
    const neonCount = await (neon as unknown as Record<ModelKey, { count: () => Promise<number> }>)[r.model as ModelKey].count();
    const ok = neonCount === r.source;
    if (!ok) {
      console.log(`  ${r.model.padEnd(28)} Turso=${r.source}  Neon=${neonCount}  MISMATCH`);
      mismatches++;
    } else {
      console.log(`  ${r.model.padEnd(28)} ${neonCount} ok`);
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
    await turso.$disconnect();
    await neon.$disconnect();
  });
