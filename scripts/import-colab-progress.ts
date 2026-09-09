/**
 * One-off importer for Colab's Daily Progress Report → Siddhi ProgressEntry
 * rows. Populates the Progress tab + Dashboard KPIs + all rollup reports
 * (Master, Cash Flow, Earned Value) with the team's historical progress.
 *
 *   PROJECT_NAME="Amanvana - Phase 1" \
 *   PROGRESS_CSV=colab-progress.csv \
 *   ALLOW_COLAB_PROGRESS_IMPORT=1 \
 *   npx tsx scripts/import-colab-progress.ts
 *
 * The hard part is matching Colab's free-text (Location, Activity_Head,
 * Activity_Name) to Siddhi's WBSNode tree — Siddhi's WBS came from an MSP
 * import so there's no shared ID column. We build an in-memory name index
 * and best-effort match. Unmatched rows are logged and counted so the
 * operator can inspect and decide whether to rerun after fixing the WBS
 * (e.g. adding missing villas or activities).
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_COLAB_PROGRESS_IMPORT !== "1") {
  console.error("Refusing: set ALLOW_COLAB_PROGRESS_IMPORT=1 to run against Neon.");
  process.exit(1);
}

const csvPathEnv = process.env.PROGRESS_CSV;
const projectName = process.env.PROJECT_NAME ?? "Amanvana - Phase 1";
if (!csvPathEnv || !existsSync(csvPathEnv)) {
  console.error("PROGRESS_CSV env var required + must exist");
  process.exit(1);
}
const csvPath: string = csvPathEnv;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { cur.push(field); field = ""; continue; }
    if (ch === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); lines.push(cur); }
  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1)
    .filter((row) => row.some((c) => c.trim().length > 0))
    .map((row) => Object.fromEntries(header.map((h, i) => [h, (row[i] ?? "").trim()])));
}

/**
 * Normalise for name-comparison: lowercase, collapse whitespace, strip
 * common junk ("-", punctuation, star markers). Colab exports have varied
 * spacing and casing that shouldn't defeat matching.
 */
function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/★/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the villa number from Colab's "Villa 32" style → "32". Returns
 * null if the location doesn't look like a numbered villa (e.g. "All
 * Locations", "Common Area").
 */
function villaNumber(locationName: string): string | null {
  const m = (locationName ?? "").match(/villa\s*(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Extract villa number from a Siddhi taskCode "V32-1.6.2.1.11" → "32".
 * Returns null for generic taskCodes without a villa prefix.
 */
function taskCodeVilla(taskCode: string): string | null {
  const m = (taskCode ?? "").match(/^V(\d+)-/i);
  return m ? m[1] : null;
}

function parseColabShortDate(raw: string): Date | null {
  // dd-mm-yy or dd-mm-yyyy
  const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yr = y.length === 2 ? 2000 + Number(y) : Number(y);
  return new Date(Date.UTC(yr, +mo - 1, +d, 12, 0, 0) - (5 * 60 + 30) * 60_000);
}

interface WbsIdx {
  byExactName: Map<string, string[]>;      // norm(name) → nodeIds
  byVillaName: Map<string, Map<string, string[]>>; // villa# → norm(name) → nodeIds
}

async function buildWbsIndex(projectId: string): Promise<WbsIdx> {
  const nodes = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, taskCode: true },
  });
  const byExactName = new Map<string, string[]>();
  const byVillaName = new Map<string, Map<string, string[]>>();
  for (const n of nodes) {
    const nm = norm(n.name);
    if (!nm) continue;
    if (!byExactName.has(nm)) byExactName.set(nm, []);
    byExactName.get(nm)!.push(n.id);
    const villa = taskCodeVilla(n.taskCode);
    if (villa) {
      if (!byVillaName.has(villa)) byVillaName.set(villa, new Map());
      const submap = byVillaName.get(villa)!;
      if (!submap.has(nm)) submap.set(nm, []);
      submap.get(nm)!.push(n.id);
    }
  }
  console.log(`WBS index: ${nodes.length} nodes, ${byExactName.size} distinct names, ${byVillaName.size} villas`);
  return { byExactName, byVillaName };
}

/**
 * Best-effort match from a Colab progress row to a WBSNode id.
 *
 * Strategy (highest specificity first):
 *   1. If villa in Location + activity name matches a villa-scoped node → that id
 *   2. If activity name matches any generic (non-villa) node → that id
 *   3. If activity name matches ANY node (villa or generic) → first id
 * Returns null if no match found.
 */
function matchWbs(
  row: Record<string, string>,
  idx: WbsIdx,
): string | null {
  // Build the activity name Colab-style. Some rows have Activity_Head +
  // Activity_Name separate; combine them for matching against Siddhi names
  // like "Reinforcement Works" or "Slab Concreting".
  const head = norm(row.Activity_Head);
  const name = norm(row.Activity_Name);
  const combined = norm(`${head} ${name}`);
  const candidates = [combined, head, name].filter((c) => c.length > 0);

  const villa = villaNumber(row.Location_Name);

  // Try villa-scoped first
  if (villa && idx.byVillaName.has(villa)) {
    const submap = idx.byVillaName.get(villa)!;
    for (const c of candidates) {
      if (submap.has(c)) return submap.get(c)![0];
    }
    // Partial match: any villa node whose name contains one of the candidates
    for (const [nm, ids] of submap.entries()) {
      for (const c of candidates) {
        if (c && (nm.includes(c) || c.includes(nm))) return ids[0];
      }
    }
  }

  // Fall back to any node with matching name
  for (const c of candidates) {
    if (idx.byExactName.has(c)) return idx.byExactName.get(c)![0];
  }

  // Loose partial match against any node
  for (const [nm, ids] of idx.byExactName.entries()) {
    for (const c of candidates) {
      if (c && c.length > 4 && (nm.includes(c) || c.includes(nm))) return ids[0];
    }
  }

  return null;
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName } });
  if (!project) { console.error(`Project not found: ${projectName}`); process.exit(1); }

  // Historical progress rows have no owner in the export. Attribute them to
  // the admin user as a system-recorded historical entry; the description /
  // notes carry the real-world context.
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) { console.error("Admin user not found — needed for historical attribution"); process.exit(1); }

  const idx = await buildWbsIndex(project.id);

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  console.log(`\nParsed ${rows.length} progress rows`);

  const contractorCache = new Map<string, string | null>();
  const stats = {
    created: 0,
    skipped: 0,
    noWbsMatch: 0,
    noDate: 0,
    unmatchedActivitiesSample: new Map<string, number>(),
  };

  let idx_i = 0;
  for (const row of rows) {
    idx_i++;
    if (idx_i % 500 === 0) console.log(`  … processed ${idx_i} / ${rows.length}`);

    const activityId = row.Activity_ID?.trim();
    const dateStr = row.Progress_Date?.trim();
    if (!activityId || !dateStr) { stats.skipped++; continue; }

    // Idempotency: (activity, date) tuple is unique per Colab row.
    const idempotencyKey = `colab-progress:${activityId}:${dateStr}`;
    const existing = await prisma.progressEntry.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) { stats.skipped++; continue; }

    const wbsNodeId = matchWbs(row, idx);
    if (!wbsNodeId) {
      stats.noWbsMatch++;
      const key = `${row.Location_Name}|${row.Activity_Head}|${row.Activity_Name}`;
      stats.unmatchedActivitiesSample.set(key, (stats.unmatchedActivitiesSample.get(key) ?? 0) + 1);
      continue;
    }

    const date = parseColabShortDate(dateStr);
    if (!date) { stats.noDate++; continue; }

    let contractorId: string | null = null;
    const contractorName = row.Contractor_Name?.replace(/^NA-/i, "").trim();
    if (contractorName) {
      if (contractorCache.has(contractorName)) {
        contractorId = contractorCache.get(contractorName) ?? null;
      } else {
        const c = await prisma.contractor.findFirst({
          where: { projectId: project.id, name: { contains: contractorName, mode: "insensitive" } },
          select: { id: true },
        });
        contractorId = c?.id ?? null;
        contractorCache.set(contractorName, contractorId);
      }
    }

    const achievedQuantity = Number(row.Achieved_Qty) || 0;
    const cumulativeQuantity = Number(row.Cumulative__achieved_Qty) || 0;

    await prisma.progressEntry.create({
      data: {
        projectId: project.id,
        wbsNodeId,
        date,
        type: "PHYSICAL_PROGRESS",
        achievedQuantity,
        cumulativeQuantity,
        contractorId,
        notes: row.Remark?.trim() || null,
        reasonNote: row.Reason_for_Delay?.trim() || null,
        createdById: admin.id,
        idempotencyKey,
        createdAt: date,
      },
    });
    stats.created++;
  }

  console.log("\n=== Import summary ===");
  console.log(`Created:            ${stats.created}`);
  console.log(`Skipped (existing): ${stats.skipped}`);
  console.log(`No WBS match:       ${stats.noWbsMatch}`);
  console.log(`Bad date:           ${stats.noDate}`);
  const matchRate = ((stats.created / (rows.length || 1)) * 100).toFixed(1);
  console.log(`Match rate:         ${matchRate}%`);
  if (stats.unmatchedActivitiesSample.size > 0) {
    console.log("\nTop 15 unmatched (Location|Head|Activity → row count):");
    Array.from(stats.unmatchedActivitiesSample.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([k, n]) => console.log(`  ${n.toString().padStart(4)}  ${k}`));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
