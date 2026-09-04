// ---------------------------------------------------------------------------
// MSP CSV → Prisma importer core.
//
// Shared between the CLI (scripts/import-msp.ts) and the /api/admin/import-msp
// route. Takes a CSV string + a Prisma-compatible client and does the same
// idempotent, transactional load into Block / Villa / MilestoneSection /
// VillaMilestone / WBSNode.
//
// Kept DB-adapter-agnostic — accepts any client shaped like PrismaClient so
// the CLI can use its own long-lived pg adapter and the API route can use the
// singleton from src/lib/prisma.
// ---------------------------------------------------------------------------

import "server-only";
import Papa from "papaparse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  ID?: string;
  "Outline Number"?: string;
  "Outline Level"?: string;
  "Task Name"?: string;
  "Baseline Start"?: string;
  "Baseline Finish"?: string;
  "Actual Start"?: string;
  "Actual Finish"?: string;
  "% Complete"?: string;
  Predecessors?: string;
  "Duration Days"?: string;
  "Resource Names"?: string;
}

interface ParsedTask {
  msId: string;
  outlineNumber: string;
  level: number;
  name: string;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number;
  predecessors: string;
  durationDays: number;
  resourceNames: string;
  isSubMilestone: boolean;
}

interface VillaMeta {
  number: number;
  unitCount: number;
  label: string | null;
}

export interface ImportStats {
  blocks: { created: number; updated: number };
  villas: { created: number; updated: number };
  sections: { created: number; updated: number };
  villaMilestones: { created: number; updated: number };
  wbsNodes: { created: number; updated: number };
  skipped: { rows: number; reasons: Record<string, number> };
  projectId?: string;
  projectName?: string;
  totalRows?: number;
  totalUnits?: number;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseDate(s: string | undefined): Date | null {
  if (!s || s.trim() === "") return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

function parseDurationDays(s: string | undefined): number {
  if (!s) return 1;
  const m = s.match(/([\d.]+)/);
  return m ? Math.max(1, Math.round(parseFloat(m[1]))) : 1;
}

function parsePercent(s: string | undefined): number {
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
 *  "Villa 10 & 11" → {number:10, unitCount:2, label:"Villa 10 & 11"} */
function parseVillaMeta(name: string): VillaMeta | null {
  const grouped = name.match(/^Villa\s+(\d+)\s*&\s*(\d+)$/i);
  if (grouped) {
    return { number: parseInt(grouped[1], 10), unitCount: 2, label: name.trim() };
  }
  const single = name.match(/^Villa\s+(\d+)$/i);
  if (single) {
    return { number: parseInt(single[1], 10), unitCount: 1, label: null };
  }
  return null;
}

/** "Foundation / Substructure" → "FOUNDATION_SUBSTRUCTURE" */
function sectionCodeFor(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// CSV → typed row parsing
// ---------------------------------------------------------------------------

export function parseCsv(csvText: string): ParsedTask[] {
  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
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
        tasks: ParsedTask[];
      }>;
    }>;
  }>;
  sectionNames: Set<string>;
}

type HBlock = Hierarchy["blocks"][number];
type HVilla = HBlock["villas"][number];
type HSection = HVilla["sections"][number];

function buildHierarchy(rows: ParsedTask[], stats: ImportStats): Hierarchy {
  const out: Hierarchy = { blocks: [], sectionNames: new Set() };
  let currentBlock: HBlock | null = null;
  let currentVilla: HVilla | null = null;
  let currentSection: HSection | null = null;

  const skip = (reason: string) => {
    stats.skipped.rows++;
    stats.skipped.reasons[reason] = (stats.skipped.reasons[reason] ?? 0) + 1;
  };

  for (const r of rows) {
    if (r.level === 2) {
      const code = parseBlockCode(r.name);
      if (!code) { skip("unparseable-block"); continue; }
      currentBlock = { row: r, code, villas: [] };
      currentVilla = null;
      currentSection = null;
      out.blocks.push(currentBlock);
    } else if (r.level === 3) {
      if (!currentBlock) { skip("villa-without-block"); continue; }
      const meta = parseVillaMeta(r.name);
      if (!meta) { skip("unparseable-villa"); continue; }
      currentVilla = { row: r, meta, sections: [] };
      currentSection = null;
      currentBlock.villas.push(currentVilla);
    } else if (r.level === 4) {
      if (!currentVilla) { skip("section-without-villa"); continue; }
      currentSection = { row: r, sectionName: r.name.trim(), tasks: [] };
      currentVilla.sections.push(currentSection);
      out.sectionNames.add(r.name.trim());
    } else if (r.level === 5) {
      if (!currentSection) { skip("task-without-section"); continue; }
      currentSection.tasks.push(r);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point — takes a CSV string + a Prisma client, does the load.
// ---------------------------------------------------------------------------

// Loosely typed so the real Prisma client, its extended variants, and test
// doubles all satisfy the shape. This is the boundary between shared logic
// and DB adapter; keeping it permissive means one signature works for CLI
// (raw client) and the API route (soft-delete-extended singleton).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

export interface ImportOptions {
  csvText: string;
  projectName: string;
  creatorUsername: string;
}

export async function importMspCsv(
  prisma: PrismaLike,
  opts: ImportOptions,
): Promise<ImportStats> {
  const rows = parseCsv(opts.csvText);
  const stats: ImportStats = {
    blocks: { created: 0, updated: 0 },
    villas: { created: 0, updated: 0 },
    sections: { created: 0, updated: 0 },
    villaMilestones: { created: 0, updated: 0 },
    wbsNodes: { created: 0, updated: 0 },
    skipped: { rows: 0, reasons: {} },
    totalRows: rows.length,
  };

  const hierarchy = buildHierarchy(rows, stats);
  stats.totalUnits = hierarchy.blocks.reduce(
    (n, b) => n + b.villas.reduce((m, v) => m + v.meta.unitCount, 0),
    0,
  );

  // Resolve creator + project outside the transaction so we don't hold locks
  // during discovery.
  const creator = await prisma.user.findUnique({ where: { username: opts.creatorUsername } });
  if (!creator) {
    throw new Error(`Creator user "${opts.creatorUsername}" not found. Seed users first.`);
  }

  const existingProject = await prisma.project.findFirst({ where: { name: opts.projectName } });

  // Everything below runs in one transaction — including the project
  // create. Previously project.create was committed BEFORE the sections /
  // blocks / villas / tasks transaction started, so a rollback of that
  // transaction left an empty Project row in the projects list until an
  // admin retried. Merging them means either the whole import lands or
  // nothing does. For an existing-project re-import, the transaction
  // still starts with the existing row and idempotent upserts do the
  // rest, so re-running after a partial failure just retries safely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let project: { id: string; name: string } = existingProject as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.$transaction(async (tx: any) => {
    if (!existingProject) {
      project = await tx.project.create({
        data: { name: opts.projectName, createdById: creator.id, status: "IN_EXECUTION" },
      });
    }
    stats.projectId = project.id;
    stats.projectName = project.name;

    // Milestone sections (unique across project)
    const sectionByName = new Map<string, string>();
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

    // Blocks + villas + villa milestones + tasks
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
          update: { blockId: block.id, unitCount: v.meta.unitCount, label: v.meta.label },
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

          let taskOrder = 0;
          for (const t of s.tasks) {
            const existingWbs = await tx.wBSNode.findUnique({
              where: { projectId_taskCode: { projectId: project.id, taskCode: t.outlineNumber } },
            });
            const payload = {
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
            };
            await tx.wBSNode.upsert({
              where: { projectId_taskCode: { projectId: project.id, taskCode: t.outlineNumber } },
              create: payload,
              update: payload,
            });
            if (existingWbs) stats.wbsNodes.updated++; else stats.wbsNodes.created++;
            taskOrder++;
          }
        }
      }
    }
  }, { timeout: 5 * 60 * 1000 });

  return stats;
}
