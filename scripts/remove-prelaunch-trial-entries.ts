/**
 * Removes progress + manpower entries made directly in Siddhi BEFORE the
 * site team got logins (Shraddha, 2026-10-07: "the real team got login on
 * Oct 1st only") — i.e. trial entries from the handover-eve sessions.
 *
 *   DATABASE_URL="postgresql://..." PROJECT_NAME="Amanvana" \
 *   MANPOWER_CSV="~/Downloads/Colab tools report - oct 7th/2026-10-07_62562038-375b-4eee-bbbf-d27fed9e96ff.csv" \
 *   npx tsx scripts/remove-prelaunch-trial-entries.ts
 *
 * Dry run by default. APPLY=1 (plus ALLOW_TRIAL_CLEANUP=1 on Neon) writes:
 *
 *  - Progress: trial entries are soft-deleted (deletedAt set — recoverable).
 *    Each affected activity is then recomputed from the entries that remain:
 *    max remaining cumulative / totalQuantity, or — when none remain — back
 *    to 0% / not entered, and an actualStart/actualFinish equal to a trial
 *    entry's date is cleared (the progress API stamps those on first entry).
 *    Touched villa milestones are re-rolled.
 *  - Manpower: one entry per (contractor, trade, day) is a unique index, so
 *    a trial row can't be deleted and re-added. Where Colab has that slot,
 *    the trial row is overwritten with Colab's count and re-keyed as the
 *    Colab row (colab-manpower:<Labour_ID>), exactly as the labour importer
 *    would have written it. Where Colab has nothing, it is soft-deleted.
 *    Re-run the labour importer afterwards to add Colab's plans for those
 *    days.
 *
 * "Trial" = created before 2026-10-01 00:00 IST and not written by a Colab
 * import.
 */

import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncVillaMilestoneFromChildren } from "../src/lib/milestoneRollup";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const apply = process.env.APPLY === "1";
if (apply && /neon\.tech/i.test(url) && process.env.ALLOW_TRIAL_CLEANUP !== "1") {
  console.error("Refusing: set ALLOW_TRIAL_CLEANUP=1 to write to Neon.");
  process.exit(1);
}
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const csvPath = (process.env.MANPOWER_CSV ?? "").replace(/^~/, process.env.HOME ?? "~");
if (!csvPath || !existsSync(csvPath)) {
  console.error("MANPOWER_CSV env var required + must exist (Colab labour export)");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const LOGINS_FROM = new Date("2026-09-30T18:30:00Z"); // 2026-10-01 00:00 IST
const isColabKey = (k: string | null) => !!k && k.startsWith("colab");
const day = (d: Date) => d.toISOString().slice(0, 10);
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");

function parseCsv(text: string): Array<Record<string, string>> {
  const [head, ...lines] = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const cols = head.replace(/^﻿/, "").split(",").map((c) => c.trim());
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v.trim()])));
}
// dd/mm/yyyy → UTC midnight, the same shape the labour importer stores.
function slashDay(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return day(new Date(Date.UTC(yr, Number(m[2]) - 1, Number(m[1]))));
}

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName }, select: { id: true, name: true } });
  if (!project) { console.error(`Project not found: "${projectName}"`); process.exit(1); }
  console.log(`Project: ${project.name}`);
  console.log(apply ? "Mode: APPLY — writing" : "Mode: DRY RUN — nothing will be written (add APPLY=1 to write)");
  console.log(`Trial = entered in Siddhi before ${ist(LOGINS_FROM)} IST\n`);

  // ---- Progress
  const trialProgress = (await prisma.progressEntry.findMany({
    where: { projectId: project.id, deletedAt: null, createdAt: { lt: LOGINS_FROM } },
    select: {
      id: true, displayId: true, date: true, cumulativeQuantity: true, idempotencyKey: true, createdAt: true, wbsNodeId: true,
      createdBy: { select: { username: true } },
    },
  })).filter((p) => !isColabKey(p.idempotencyKey));
  console.log(`=== Progress: ${trialProgress.length} trial entr${trialProgress.length === 1 ? "y" : "ies"} to soft-delete ===`);
  for (const p of trialProgress) {
    console.log(`  ${p.displayId ?? p.id}  for ${day(p.date)}  entered ${ist(p.createdAt)} IST by ${p.createdBy.username}  cumulative ${p.cumulativeQuantity}`);
  }

  const trialIds = new Set(trialProgress.map((p) => p.id));
  const trialDays = new Map<string, Set<number>>();
  for (const p of trialProgress) {
    const s = trialDays.get(p.wbsNodeId) ?? new Set<number>();
    s.add(p.date.getTime());
    trialDays.set(p.wbsNodeId, s);
  }
  const nodes = await prisma.wBSNode.findMany({
    where: { id: { in: [...trialDays.keys()] } },
    select: {
      id: true, name: true, percentComplete: true, progressEntered: true, totalQuantity: true,
      actualStart: true, actualFinish: true, villaMilestoneId: true,
      villaMilestone: { select: { villa: { select: { number: true } } } },
      progressEntries: {
        where: { deletedAt: null, status: "PUBLISHED" },
        select: { id: true, cumulativeQuantity: true },
      },
    },
  });
  type NodeFix = { id: string; label: string; vm: string | null; data: Record<string, unknown>; before: string; after: string };
  const fixes: NodeFix[] = [];
  for (const n of nodes) {
    const remaining = n.progressEntries.filter((e) => !trialIds.has(e.id));
    const tDays = trialDays.get(n.id)!;
    const data: Record<string, unknown> = {};
    if (remaining.length === 0) {
      data.percentComplete = 0;
      data.progressEntered = false;
    } else if (n.totalQuantity && n.totalQuantity > 0) {
      const maxCum = Math.max(...remaining.map((e) => e.cumulativeQuantity));
      data.percentComplete = Math.max(0, Math.min(100, (maxCum / n.totalQuantity) * 100));
    }
    if (n.actualStart && tDays.has(n.actualStart.getTime())) data.actualStart = null;
    if (n.actualFinish && tDays.has(n.actualFinish.getTime())) data.actualFinish = null;
    const changed = Object.entries(data).filter(([k, v]) => (n as Record<string, unknown>)[k] !== v);
    if (changed.length === 0) continue;
    fixes.push({
      id: n.id,
      label: `${n.villaMilestone ? `Villa ${n.villaMilestone.villa.number} · ` : ""}${n.name}`,
      vm: n.villaMilestoneId,
      data: Object.fromEntries(changed),
      before: `${n.percentComplete.toFixed(1)}%${n.actualStart ? `, start ${day(n.actualStart)}` : ""}`,
      after: changed.map(([k, v]) => `${k}=${v instanceof Date ? day(v) : v}`).join(", "),
    });
  }
  console.log(`\nActivities whose figures change: ${fixes.length}`);
  for (const f of fixes) console.log(`  ${f.label}: ${f.before} → ${f.after}`);

  // ---- Manpower
  const trialManpower = (await prisma.manpowerEntry.findMany({
    where: { projectId: project.id, deletedAt: null, createdAt: { lt: LOGINS_FROM } },
    select: {
      id: true, trade: true, entryDate: true, actualCount: true, idempotencyKey: true, createdAt: true,
      contractor: { select: { name: true } }, createdBy: { select: { username: true } },
    },
  })).filter((m) => !isColabKey(m.idempotencyKey));
  const colab = new Map<string, { labourId: string; actual: number }>();
  for (const r of parseCsv(readFileSync(csvPath, "utf8"))) {
    const d = slashDay(r.Date ?? "");
    const actual = Math.round(Number(r.Actual_Labour));
    if (!d || !r.Labour_ID || !Number.isFinite(actual) || actual <= 0) continue;
    const contractor = (r.Contractor_Name ?? "").replace(/^NA-/i, "").trim().toLowerCase();
    colab.set(`${contractor}|${(r.Trade_Name ?? "").trim()}|${d}`, { labourId: r.Labour_ID.trim(), actual });
  }
  console.log(`\n=== Manpower: ${trialManpower.length} trial entr${trialManpower.length === 1 ? "y" : "ies"} ===`);
  const mpPlan = trialManpower.map((m) => {
    const c = colab.get(`${m.contractor.name.toLowerCase()}|${m.trade}|${day(m.entryDate)}`);
    console.log(
      `  ${day(m.entryDate)}  ${m.contractor.name} · ${m.trade}  Siddhi ${m.actualCount}  entered ${ist(m.createdAt)} IST by ${m.createdBy.username}` +
      (c ? `  → replace with Colab ${c.actual} (Labour_ID ${c.labourId})` : "  → soft-delete (Colab has no row)"),
    );
    return { m, c };
  });

  if (!apply) { console.log("\nDry run only — nothing written."); return; }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (trialProgress.length) {
      await tx.progressEntry.updateMany({ where: { id: { in: [...trialIds] } }, data: { deletedAt: now } });
    }
    for (const f of fixes) await tx.wBSNode.update({ where: { id: f.id }, data: f.data });
    for (const vm of new Set(fixes.map((f) => f.vm).filter((v): v is string => !!v))) {
      await syncVillaMilestoneFromChildren(tx, vm);
    }
    for (const { m, c } of mpPlan) {
      await tx.manpowerEntry.update({
        where: { id: m.id },
        data: c
          ? { actualCount: c.actual, idempotencyKey: `colab-manpower:${c.labourId}`, notes: `Replaced pre-launch trial entry (was ${m.actualCount}) with Colab` }
          : { deletedAt: now },
      });
    }
  }, { timeout: 120_000 });
  console.log(`\nDone: ${trialProgress.length} progress entr${trialProgress.length === 1 ? "y" : "ies"} soft-deleted, ${fixes.length} activit${fixes.length === 1 ? "y" : "ies"} recomputed, ${mpPlan.filter((x) => x.c).length} manpower row(s) replaced with Colab, ${mpPlan.filter((x) => !x.c).length} soft-deleted.`);
  console.log("Next: re-run the labour importer (APPLY=1) to add Colab's planned headcounts for those days.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
