/**
 * Colab Locations master → Siddhi villa tree reconciliation.
 *
 *   DATABASE_URL="postgresql://..." \
 *   PROJECT_NAME="Amanvana" \
 *   LOCATIONS_CSV="~/Downloads/colab tools final reports/2026-10-01_9689a157-7f68-4580-8431-aa56a6500a63.csv" \
 *   npx tsx scripts/reconcile-colab-locations.ts
 *
 * Dry run by default. APPLY=1 (plus ALLOW_COLAB_LOCATIONS_IMPORT=1 on
 * Neon) creates the missing placeholder villas.
 *
 * Colab's export is flat: location (villa) → sublocation (Footing, Plinth,
 * Gr Floor, ...) → sub-sublocation. Siddhi's tree is Block → Villa →
 * VillaMilestone (21 MSP sections) → WBSNode, built by the MSP import.
 * Colab sublocations are NOT separate Siddhi rows — they resolve to MSP
 * sections through src/lib/colabSyncMapping.ts. So the only thing that
 * can actually be missing is a Villa, which is what the Villa-4 bug was.
 *
 * Colab has no block concept. Per Shraddha (2026-10-02), Colab's
 * placeholder villas (one "All Floors" row, no schedule yet) are created
 * inScope in a holding block "Unscheduled"; the MSP import re-parents each
 * one to its real block when its schedule lands. Villas that exist in
 * Siddhi are never touched, so re-running only creates what's missing.
 * Missing villas with a full Colab tree are reported, not created — those
 * should already have come from an MSP schedule and need a real block.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { mapColabToMspSection } from "../src/lib/colabSyncMapping";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const csvPath = (process.env.LOCATIONS_CSV ?? "").replace(/^~/, process.env.HOME ?? "~");
if (!csvPath || !existsSync(csvPath)) {
  console.error("LOCATIONS_CSV env var required + must exist");
  process.exit(1);
}
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const apply = process.env.APPLY === "1";
if (apply && /neon\.tech/i.test(url) && process.env.ALLOW_COLAB_LOCATIONS_IMPORT !== "1") {
  console.error("Refusing: set ALLOW_COLAB_LOCATIONS_IMPORT=1 to write to Neon.");
  process.exit(1);
}
const HOLDING_BLOCK_CODE = "UNSCHEDULED";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// The export has no quoted fields, but parse quotes anyway so a future
// export with a comma in a name doesn't silently shift columns.
function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
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
  const header = lines.shift()!.map((h) => h.replace(/^﻿/, "").trim());
  return lines
    .filter((l) => l.some((f) => f.trim()))
    .map((l) => Object.fromEntries(header.map((h, i) => [h, (l[i] ?? "").trim()])));
}

interface ColabVilla {
  locationId: string;
  label: string;        // "Villa 10 & 11"
  number: number;       // 10 (primary number, matches Villa.number)
  unitCount: number;    // 2 for grouped villas
  sublocations: string[];
}

// "Villa 03" → 3; "Villa 10 & 11" → 10 with unitCount 2.
function parseVillaLabel(name: string): { number: number; unitCount: number } | null {
  const m = /^Villa\s+(\d+)(?:\s*&\s*(\d+))?$/i.exec(name.trim());
  if (!m) return null;
  return { number: Number(m[1]), unitCount: m[2] ? 2 : 1 };
}

async function main() {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  console.log(`CSV: ${rows.length} rows`);

  const projects = new Set(rows.map((r) => r.project_name));
  if (projects.size !== 1) console.warn(`! CSV spans ${projects.size} projects: ${[...projects].join(", ")}`);

  const colab = new Map<number, ColabVilla>();
  const pseudo: string[] = [];
  for (const r of rows) {
    const parsed = parseVillaLabel(r.location_name);
    if (!parsed) {
      if (!pseudo.includes(r.location_name)) pseudo.push(r.location_name);
      continue;
    }
    const v = colab.get(parsed.number) ?? {
      locationId: r.location_id, label: r.location_name, ...parsed, sublocations: [],
    };
    v.sublocations.push(r.sublocation_name);
    colab.set(parsed.number, v);
  }

  // Sublocation names Siddhi can't place. "All Floors" is resolved per
  // activity (type + head) at progress-import time, so it's checked there.
  const unmappedSubs = new Set<string>();
  for (const v of colab.values()) {
    for (const s of v.sublocations) {
      if (s !== "All Floors" && !mapColabToMspSection(s, "", "")) unmappedSubs.add(s);
    }
  }

  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }
  const villas = await prisma.villa.findMany({
    where: { projectId: project.id },
    select: {
      id: true, number: true, label: true, unitCount: true, inScope: true,
      block: { select: { code: true } },
      _count: { select: { milestones: true } },
    },
    orderBy: { number: "asc" },
  });
  const siddhi = new Map(villas.map((v) => [v.number, v]));
  // A grouped Colab villa ("10 & 11") must not also exist as a separate
  // Siddhi villa 11 — that would double-count units.
  const secondaryNumbers = new Set(
    [...colab.values()].filter((v) => v.unitCount === 2).map((v) => v.number + 1),
  );

  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Colab villas: ${colab.size} (${[...colab.values()].reduce((n, v) => n + v.unitCount, 0)} units)`);
  console.log(`Siddhi villas: ${villas.length} (${villas.reduce((n, v) => n + v.unitCount, 0)} units)`);
  console.log(`Colab pseudo-locations (not villas, skipped): ${pseudo.join(" · ") || "none"}`);
  console.log(`Sublocations with no MSP section mapping: ${[...unmappedSubs].join(" · ") || "none"}`);

  const missing: ColabVilla[] = [];
  const mismatched: string[] = [];
  for (const c of [...colab.values()].sort((a, b) => a.number - b.number)) {
    const s = siddhi.get(c.number);
    if (!s) { missing.push(c); continue; }
    if (s.unitCount !== c.unitCount) {
      mismatched.push(`Villa ${c.number}: unitCount Siddhi=${s.unitCount} Colab=${c.unitCount} ("${c.label}")`);
    }
  }
  const siddhiOnly = villas.filter((v) => !colab.has(v.number));
  const doubleCounted = villas.filter((v) => secondaryNumbers.has(v.number));

  console.log(`\n── Matched: ${colab.size - missing.length}`);
  // Colab placeholders are the locations with only the "All Floors" row.
  const isPlaceholder = (c: ColabVilla) => c.sublocations.length === 1 && c.sublocations[0] === "All Floors";
  const toCreate = missing.filter(isPlaceholder);
  const needsBlock = missing.filter((c) => !isPlaceholder(c));
  const placeholders = [...colab.values()].filter(isPlaceholder);

  console.log(`\n── Colab placeholders: ${placeholders.length} · already in Siddhi: ${placeholders.length - toCreate.length} · to create in "Unscheduled": ${toCreate.length}`);
  for (const c of toCreate) console.log(`  + ${c.label.padEnd(16)} colab_location_id=${c.locationId}`);
  for (const c of placeholders.filter((p) => siddhi.has(p.number))) {
    console.log(`  = ${c.label.padEnd(16)} exists in block ${siddhi.get(c.number)!.block.code} — left alone`);
  }
  console.log(`\n── Full-tree Colab villas missing in Siddhi (NOT created, need a real block): ${needsBlock.length}`);
  for (const c of needsBlock) console.log(`  ! ${c.label.padEnd(16)} colab_location_id=${c.locationId}`);
  console.log(`\n── In Siddhi, not in Colab: ${siddhiOnly.length}`);
  for (const v of siddhiOnly) {
    console.log(`  Villa ${v.number} (${v.label ?? "-"}) block=${v.block.code} inScope=${v.inScope} milestones=${v._count.milestones}`);
  }
  console.log(`\n── unitCount mismatches: ${mismatched.length}`);
  for (const m of mismatched) console.log(`  ${m}`);
  console.log(`\n── Grouped-villa partners existing as separate Siddhi villas: ${doubleCounted.length}`);
  for (const v of doubleCounted) console.log(`  Villa ${v.number} (${v.label ?? "-"}) block=${v.block.code}`);

  const noMilestones = villas.filter((v) => colab.get(v.number)?.sublocations.length === 12 && v._count.milestones === 0);
  console.log(`\n── Active in Colab (full tree) but no milestones in Siddhi: ${noMilestones.length}`);
  for (const v of noMilestones) console.log(`  Villa ${v.number} block=${v.block.code}`);

  if (!apply) {
    console.log("\nDry run only — nothing written. Re-run with APPLY=1 to create the placeholders.");
    return;
  }
  // These would be baked in by creating villas around them — fix first.
  if (mismatched.length || doubleCounted.length) {
    console.error("\nRefusing to apply: resolve the unitCount / grouped-villa issues above first.");
    process.exit(1);
  }
  if (toCreate.length === 0) {
    console.log("\nNothing to create.");
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.block.findFirst({
      where: { projectId: project.id },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    // active=false: execution hasn't begun on anything in this block.
    const holding = await tx.block.upsert({
      where: { projectId_code: { projectId: project.id, code: HOLDING_BLOCK_CODE } },
      create: {
        projectId: project.id, code: HOLDING_BLOCK_CODE, name: "Unscheduled",
        active: false, orderIndex: (last?.orderIndex ?? -1) + 1,
      },
      update: {},
      select: { id: true },
    });
    let n = 0;
    for (const c of toCreate) {
      const exists = await tx.villa.findUnique({
        where: { projectId_number: { projectId: project.id, number: c.number } },
        select: { id: true },
      });
      if (exists) continue;
      await tx.villa.create({
        data: {
          projectId: project.id, blockId: holding.id, number: c.number,
          unitCount: c.unitCount, label: c.unitCount > 1 ? c.label : null, inScope: true,
        },
      });
      n++;
    }
    return n;
  });
  console.log(`\nCreated ${created} villa(s) in block "Unscheduled".`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
