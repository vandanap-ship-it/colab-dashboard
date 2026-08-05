/**
 * MSP CSV → Prisma importer for Amanvana villa project.
 *
 * Reads a CSV exported from MS Project (via scripts/convert-mpp.py or manual
 * File → Save As → CSV) and upserts the entire schedule into Prisma:
 *
 *   MSP outline level → our model
 *   ─────────────────────────────
 *   L1  Contractor scope       (ignored — inferred by convention)
 *   L2  Block                  → Block
 *   L3  Villa                  → Villa
 *   L4  Milestone section      → MilestoneSection (per project, seeded once)
 *                              + VillaMilestone (one per villa × section)
 *   L5  Task / ★ sub-milestone → WBSNode (with isSubMilestone flag)
 *
 * Design principles:
 *   • Idempotent  — safe to re-run on every MSP update. Uses upsert everywhere.
 *   • Transactional — all writes wrapped in a single Prisma tx. Either the
 *     whole import succeeds or nothing changes.
 *   • Well-logged — prints a summary of what was created / updated / skipped.
 *   • Defensive — skips malformed rows with warnings rather than aborting.
 *
 * Usage:
 *   pnpm tsx scripts/import-msp.ts \
 *     --csv scratchpad-data/amanvana_msp.csv \
 *     --project "Amanvana" \
 *     --creator admin
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Papa from "papaparse";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  ID: string;
  "Outline Number": string;
  "Outline Level": string;
  "Task Name": string;
  "Baseline Start": string;
  "Baseline Finish": string;
  "Actual Start": string;
  "Actual Finish": string;
  "% Complete": string;
  Predecessors: string;
  "Duration Days": string;
  "Resource Names": string;
}

interface ParsedTask {
  msId: string;                 // MSP task ID (row 5 → "5")
  outlineNumber: string;        // "1.1.1.1.7"
  level: number;                // integer 0-5
  name: string;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number;      // 0-100
  predecessors: string;         // comma-sep MSP IDs
  durationDays: number;         // parsed from "5.0d" strings
  resourceNames: string;
  isSubMilestone: boolean;      // ★ in name
}

interface VillaMeta {
  number: number;
  unitCount: number;
  label: string | null;         // "Villa 10 & 11" if grouped, else null
}

interface ImportStats {
  blocks: { created: number; updated: number };
  villas: { created: number; updated: number };
  sections: { created: number; updated: number };
  villaMilestones: { created: number; updated: number };
  wbsNodes: { created: number; updated: number };
  skipped: { rows: number; reasons: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseDate(s: string): Date | null {
  if (!s || s.trim() === "") return null;
  // MSP CSV format we produce: yyyy-MM-dd
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function parseDurationDays(s: string): number {
  if (!s) return 1;
  const m = s.match(/([\d.]+)/);
  return m ? Math.max(1, Math.round(parseFloat(m[1]))) : 1;
}

function parsePercent(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
}

/** "Block 9" → "9", "Block 3 A" → "3A" */
function parseBlockCode(name: string): string | null {
  const m = name.match(/^Block\s+(.+?)$/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, "").toUpperCase();
}

/** "Villa 25" → {number:25, unitCount:1, label:null}
 *  "Villa 10 & 11" → {number:10, unitCount:2, label:"Villa 10 & 11"}
 *  "Villa 03" → {number:3, unitCount:1, label:null} */
function parseVillaMeta(name: string): VillaMeta | null {
  const grouped = name.match(/^Villa\s+(\d+)\s*&\s*(\d+)$/i);
  if (grouped) {
    return {
      number: parseInt(grouped[1], 10),
      unitCount: 2,
      label: name.trim(),
    };
  }
  const single = name.match(/^Villa\s+(\d+)$/i);
  if (single) {
    return { number: parseInt(single[1], 10), unitCount: 1, label: null };
  }
  return null;
}

/** "Foundation / Substructure" → "FOUNDATION_SUBSTRUCTURE" */
function sectionCodeFor(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// CSV → typed row parsing
// ---------------------------------------------------------------------------

function readCsv(csvPath: string): ParsedTask[] {
  const raw = fs.readFileSync(csvPath, "utf-8");
  const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    console.warn(`CSV had ${parsed.errors.length} parse warnings (proceeding):`, parsed.errors.slice(0, 3));
  }
  const rows: ParsedTask[] = [];
  for (const r of parsed.data) {
    const name = r["Task Name"]?.trim();
    if (!name) continue;
    const level = parseInt(r["Outline Level"] || "0", 10);
    if (isNaN(level)) continue;
    rows.push({
      msId: r.ID?.trim() ?? "",
      outlineNumber: r["Outline Number"]?.trim() ?? "",
      level,
      name,
      baselineStart: parseDate(r["Baseline Start"]),
      baselineFinish: parseDate(r["Baseline Finish"]),
      actualStart: parseDate(r["Actual Start"]),
      actualFinish: parseDate(r["Actual Finish"]),
      percentComplete: parsePercent(r["% Complete"]),
      predecessors: r.Predecessors?.trim() ?? "",
      durationDays: parseDurationDays(r["Duration Days"]),
      resourceNames: r["Resource Names"]?.trim() ?? "",
      isSubMilestone: name.includes("★"),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Hierarchy walker
// ---------------------------------------------------------------------------

interface Hierarchy {
  blocks: Array<{
    row: ParsedTask;
    code: string;
    villas: Array<{
      row: ParsedTask;
      meta: VillaMeta;
      sections: Array<{
        row: ParsedTask;
        sectionName: string;
        tasks: ParsedTask[];       // Level 5 items in outline order
      }>;
    }>;
  }>;
  sectionNames: Set<string>;       // unique milestone names across the project
}

type HBlock = Hierarchy["blocks"][number];
type HVilla = HBlock["villas"][number];
type HSection = HVilla["sections"][number];

function buildHierarchy(rows: ParsedTask[], stats: ImportStats): Hierarchy {
  const out: Hierarchy = { blocks: [], sectionNames: new Set() };

  let currentBlock: HBlock | null = null;
  let currentVilla: HVilla | null = null;
  let currentSection: HSection | null = null;

  for (const r of rows) {
    if (r.level === 2) {
      const code = parseBlockCode(r.name);
      if (!code) {
        stats.skipped.rows++;
        stats.skipped.reasons["unparseable-block"] = (stats.skipped.reasons["unparseable-block"] ?? 0) + 1;
        continue;
      }
      currentBlock = { row: r, code, villas: [] };
      currentVilla = null;
      currentSection = null;
      out.blocks.push(currentBlock);
    } else if (r.level === 3) {
      if (!currentBlock) {
        stats.skipped.rows++;
        stats.skipped.reasons["villa-without-block"] = (stats.skipped.reasons["villa-without-block"] ?? 0) + 1;
        continue;
      }
      const meta = parseVillaMeta(r.name);
      if (!meta) {
        stats.skipped.rows++;
        stats.skipped.reasons["unparseable-villa"] = (stats.skipped.reasons["unparseable-villa"] ?? 0) + 1;
        continue;
      }
      currentVilla = { row: r, meta, sections: [] };
      currentSection = null;
      currentBlock.villas.push(currentVilla);
    } else if (r.level === 4) {
      if (!currentVilla) {
        stats.skipped.rows++;
        stats.skipped.reasons["section-without-villa"] = (stats.skipped.reasons["section-without-villa"] ?? 0) + 1;
        continue;
      }
      currentSection = { row: r, sectionName: r.name.trim(), tasks: [] };
      currentVilla.sections.push(currentSection);
      out.sectionNames.add(r.name.trim());
    } else if (r.level === 5) {
      if (!currentSection) {
        stats.skipped.rows++;
        stats.skipped.reasons["task-without-section"] = (stats.skipped.reasons["task-without-section"] ?? 0) + 1;
        continue;
      }
      currentSection.tasks.push(r);
    }
    // Level 0 (root) and Level 1 (contractor scope) are ignored — we infer
    // the contractor via project convention.
  }

  return out;
}

// ---------------------------------------------------------------------------
// Prisma writes (all inside one transaction)
// ---------------------------------------------------------------------------

async function importAll(opts: {
  csvPath: string;
  projectName: string;
  creatorUsername: string;
}) {
  const rows = readCsv(opts.csvPath);
  console.log(`Read ${rows.length} rows from ${opts.csvPath}`);

  const stats: ImportStats = {
    blocks: { created: 0, updated: 0 },
    villas: { created: 0, updated: 0 },
    sections: { created: 0, updated: 0 },
    villaMilestones: { created: 0, updated: 0 },
    wbsNodes: { created: 0, updated: 0 },
    skipped: { rows: 0, reasons: {} },
  };

  const hierarchy = buildHierarchy(rows, stats);
  const totalVillas = hierarchy.blocks.reduce((n, b) => n + b.villas.length, 0);
  const totalUnits = hierarchy.blocks.reduce(
    (n, b) => n + b.villas.reduce((m, v) => m + v.meta.unitCount, 0), 0,
  );
  const totalTasks = hierarchy.blocks.reduce(
    (n, b) => n + b.villas.reduce(
      (m, v) => m + v.sections.reduce((k, s) => k + s.tasks.length, 0), 0,
    ), 0,
  );
  console.log(`Hierarchy: ${hierarchy.blocks.length} blocks · ${totalVillas} villa records (${totalUnits} physical units) · ${hierarchy.sectionNames.size} distinct sections · ${totalTasks} tasks`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    // Resolve creator + project OUTSIDE the transaction so we don't hold locks
    // during the resolve phase. Project is looked up by name (not unique in
    // schema, so we can't use upsert by name directly).
    const creator = await prisma.user.findUnique({ where: { username: opts.creatorUsername } });
    if (!creator) throw new Error(`Creator user "${opts.creatorUsername}" not found. Seed users first.`);

    const existing = await prisma.project.findFirst({ where: { name: opts.projectName } });
    const project = existing
      ? existing
      : await prisma.project.create({
          data: { name: opts.projectName, createdById: creator.id, status: "IN_EXECUTION" },
        });
    console.log(`Project: ${project.name} (${project.id})`);

    await prisma.$transaction(async (tx) => {

      // 2. Milestone sections (unique across project)
      const sectionByName = new Map<string, string>();  // name → sectionId
      let sectionOrder = 0;
      for (const name of hierarchy.sectionNames) {
        const code = sectionCodeFor(name);
        const existing = await tx.milestoneSection.findUnique({
          where: { projectId_code: { projectId: project.id, code } },
        });
        const rec = await tx.milestoneSection.upsert({
          where: { projectId_code: { projectId: project.id, code } },
          create: { projectId: project.id, code, name, orderIndex: sectionOrder },
          update: { name, orderIndex: sectionOrder },
        });
        sectionByName.set(name, rec.id);
        if (existing) stats.sections.updated++; else stats.sections.created++;
        sectionOrder++;
      }

      // 3. Blocks + villas + villa milestones + tasks
      let blockOrder = 0;
      for (const b of hierarchy.blocks) {
        const existingBlock = await tx.block.findUnique({
          where: { projectId_code: { projectId: project.id, code: b.code } },
        });
        const block = await tx.block.upsert({
          where: { projectId_code: { projectId: project.id, code: b.code } },
          create: {
            projectId: project.id, code: b.code,
            name: b.row.name, active: true, orderIndex: blockOrder,
          },
          update: { name: b.row.name, orderIndex: blockOrder },
        });
        if (existingBlock) stats.blocks.updated++; else stats.blocks.created++;
        blockOrder++;

        for (const v of b.villas) {
          const existingVilla = await tx.villa.findUnique({
            where: { projectId_number: { projectId: project.id, number: v.meta.number } },
          });
          const villa = await tx.villa.upsert({
            where: { projectId_number: { projectId: project.id, number: v.meta.number } },
            create: {
              projectId: project.id, blockId: block.id,
              number: v.meta.number, unitCount: v.meta.unitCount, label: v.meta.label,
            },
            update: {
              blockId: block.id,
              unitCount: v.meta.unitCount, label: v.meta.label,
            },
          });
          if (existingVilla) stats.villas.updated++; else stats.villas.created++;

          for (const s of v.sections) {
            const sectionId = sectionByName.get(s.sectionName);
            if (!sectionId) continue;
            const existingVM = await tx.villaMilestone.findUnique({
              where: { villaId_sectionId: { villaId: villa.id, sectionId } },
            });
            const vm = await tx.villaMilestone.upsert({
              where: { villaId_sectionId: { villaId: villa.id, sectionId } },
              create: {
                villaId: villa.id, sectionId,
                baselineStart: s.row.baselineStart,
                baselineFinish: s.row.baselineFinish,
                actualStart: s.row.actualStart,
                actualFinish: s.row.actualFinish,
                pctComplete: s.row.percentComplete,
              },
              update: {
                baselineStart: s.row.baselineStart,
                baselineFinish: s.row.baselineFinish,
                actualStart: s.row.actualStart,
                actualFinish: s.row.actualFinish,
                pctComplete: s.row.percentComplete,
              },
            });
            if (existingVM) stats.villaMilestones.updated++; else stats.villaMilestones.created++;

            // Level 5: tasks + ★ sub-milestones
            let taskOrder = 0;
            for (const t of s.tasks) {
              // taskCode = MSP outline number (unique per project by construction)
              const existingWbs = await tx.wBSNode.findUnique({
                where: { projectId_taskCode: { projectId: project.id, taskCode: t.outlineNumber } },
              });
              await tx.wBSNode.upsert({
                where: { projectId_taskCode: { projectId: project.id, taskCode: t.outlineNumber } },
                create: {
                  projectId: project.id,
                  taskCode: t.outlineNumber,
                  name: t.name,
                  level: t.level,
                  orderIndex: taskOrder,
                  baselineStart: t.baselineStart,
                  baselineFinish: t.baselineFinish,
                  actualStart: t.actualStart,
                  actualFinish: t.actualFinish,
                  percentComplete: t.percentComplete,
                  predecessorsRaw: t.predecessors || null,
                  villaId: villa.id,
                  sectionId,
                  villaMilestoneId: vm.id,
                  isSubMilestone: t.isSubMilestone,
                  progressEntered: t.actualStart != null || t.percentComplete > 0,
                },
                update: {
                  name: t.name,
                  level: t.level,
                  orderIndex: taskOrder,
                  baselineStart: t.baselineStart,
                  baselineFinish: t.baselineFinish,
                  actualStart: t.actualStart,
                  actualFinish: t.actualFinish,
                  percentComplete: t.percentComplete,
                  predecessorsRaw: t.predecessors || null,
                  villaId: villa.id,
                  sectionId,
                  villaMilestoneId: vm.id,
                  isSubMilestone: t.isSubMilestone,
                  progressEntered: t.actualStart != null || t.percentComplete > 0,
                },
              });
              if (existingWbs) stats.wbsNodes.updated++; else stats.wbsNodes.created++;
              taskOrder++;
            }
          }
        }
      }
    }, { timeout: 5 * 60 * 1000 });  // 5-min tx timeout for large imports
  } finally {
    await prisma.$disconnect();
  }

  return stats;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): { csv: string; project: string; creator: string } {
  const args = process.argv.slice(2);
  const out: Record<string, string> = { creator: "admin" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--csv") out.csv = args[++i];
    else if (a === "--project") out.project = args[++i];
    else if (a === "--creator") out.creator = args[++i];
  }
  if (!out.csv) out.csv = "scratchpad-data/amanvana_msp.csv";
  if (!out.project) out.project = "Amanvana";
  return out as { csv: string; project: string; creator: string };
}

async function main() {
  const { csv, project, creator } = parseArgs();
  const csvAbs = path.resolve(process.cwd(), csv);
  if (!fs.existsSync(csvAbs)) {
    console.error(`✗ CSV not found: ${csvAbs}`);
    process.exit(1);
  }
  console.log(`── MSP Importer ──`);
  console.log(`  CSV      ${csvAbs}`);
  console.log(`  Project  ${project}`);
  console.log(`  Creator  ${creator}`);
  console.log(``);

  const t0 = Date.now();
  const stats = await importAll({ csvPath: csvAbs, projectName: project, creatorUsername: creator });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(``);
  console.log(`── Done in ${secs}s ──`);
  console.log(`  Blocks           ${stats.blocks.created} created · ${stats.blocks.updated} updated`);
  console.log(`  Villas           ${stats.villas.created} created · ${stats.villas.updated} updated`);
  console.log(`  Sections         ${stats.sections.created} created · ${stats.sections.updated} updated`);
  console.log(`  Villa milestones ${stats.villaMilestones.created} created · ${stats.villaMilestones.updated} updated`);
  console.log(`  WBS nodes        ${stats.wbsNodes.created} created · ${stats.wbsNodes.updated} updated`);
  if (stats.skipped.rows > 0) {
    console.log(`  Skipped rows     ${stats.skipped.rows}`);
    for (const [reason, count] of Object.entries(stats.skipped.reasons)) {
      console.log(`    · ${reason}: ${count}`);
    }
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
