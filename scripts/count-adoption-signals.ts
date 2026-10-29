/**
 * Counts rows per adoption surface in Siddhi so Vandana can quote
 * numbers in team conversations ("the site team has entered X progress
 * logs since handover"). READ-ONLY.
 *
 * Three windows per surface:
 *   - all time (handover was 2026-09-30, so this is effectively since launch)
 *   - last 30 days
 *   - last 7 days
 *
 * Separates "real site team activity" (excludes rows created by Colab import
 * or by any ADMIN account) from the raw row count so the number reflects
 * actual adoption, not seeded data.
 *
 *   DATABASE_URL="postgresql://..." PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/count-adoption-signals.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const now = new Date();
const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

const isColab = (k: string | null | undefined) => !!k && k.startsWith("colab");

type Row = { surface: string; all: number; d30: number; d7: number; real: number };

function fmt(n: number, w = 6) { return String(n).padStart(w, " "); }

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName }, select: { id: true, name: true } });
  if (!project) { console.error(`Project not found: "${projectName}"`); process.exit(1); }
  const pid = project.id;

  // User list for "real = non-admin" filter
  const adminIds = new Set(
    (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => u.id),
  );
  const isAdmin = (uid: string | null | undefined) => !!uid && adminIds.has(uid);

  const rows: Row[] = [];

  // ---------- 1. Progress logs ----------
  const progress = await prisma.progressEntry.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { createdAt: true, idempotencyKey: true, createdById: true },
  });
  rows.push({
    surface: "Progress logs",
    all: progress.length,
    d30: progress.filter((p) => p.createdAt >= d30).length,
    d7: progress.filter((p) => p.createdAt >= d7).length,
    real: progress.filter((p) => !isColab(p.idempotencyKey) && !isAdmin(p.createdById)).length,
  });

  // ---------- 2. Manpower logs (standalone) ----------
  const manpower = await prisma.manpowerEntry.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { createdAt: true, idempotencyKey: true, createdById: true },
  });
  rows.push({
    surface: "Manpower logs (standalone)",
    all: manpower.length,
    d30: manpower.filter((m) => m.createdAt >= d30).length,
    d7: manpower.filter((m) => m.createdAt >= d7).length,
    real: manpower.filter((m) => !isColab(m.idempotencyKey) && !isAdmin(m.createdById)).length,
  });

  // ---------- 3. Labour on progress (ProgressLabour) ----------
  // These are per-activity labour counts logged inside a progress entry.
  const progressLabour = await prisma.progressLabour.findMany({
    where: { progressEntry: { projectId: pid, deletedAt: null } },
    select: { progressEntry: { select: { createdAt: true, idempotencyKey: true, createdById: true } } },
  });
  rows.push({
    surface: "Labour on progress (rows)",
    all: progressLabour.length,
    d30: progressLabour.filter((r) => r.progressEntry.createdAt >= d30).length,
    d7: progressLabour.filter((r) => r.progressEntry.createdAt >= d7).length,
    real: progressLabour.filter((r) => !isColab(r.progressEntry.idempotencyKey) && !isAdmin(r.progressEntry.createdById)).length,
  });

  // ---------- 4. Labour on permits (PermitLabourEntry) ----------
  const permitLabour = await prisma.permitLabourEntry.findMany({
    where: { workPermit: { projectId: pid, deletedAt: null } },
    select: { createdAt: true, workPermit: { select: { requesterId: true, idempotencyKey: true } } },
  });
  rows.push({
    surface: "Labour on permits (rows)",
    all: permitLabour.length,
    d30: permitLabour.filter((r) => r.createdAt >= d30).length,
    d7: permitLabour.filter((r) => r.createdAt >= d7).length,
    real: permitLabour.filter((r) => !isColab(r.workPermit.idempotencyKey) && !isAdmin(r.workPermit.requesterId)).length,
  });

  // ---------- 5. Work Permits ----------
  const permits = await prisma.workPermit.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { createdAt: true, idempotencyKey: true, requesterId: true },
  });
  rows.push({
    surface: "Work Permits",
    all: permits.length,
    d30: permits.filter((p) => p.createdAt >= d30).length,
    d7: permits.filter((p) => p.createdAt >= d7).length,
    real: permits.filter((p) => !isColab(p.idempotencyKey) && !isAdmin(p.requesterId)).length,
  });

  // ---------- 6. Safety Inductions ----------
  const inductions = await prisma.safetyInduction.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { createdAt: true, idempotencyKey: true, createdById: true },
  });
  rows.push({
    surface: "Safety Inductions",
    all: inductions.length,
    d30: inductions.filter((i) => i.createdAt >= d30).length,
    d7: inductions.filter((i) => i.createdAt >= d7).length,
    real: inductions.filter((i) => !isColab(i.idempotencyKey) && !isAdmin(i.createdById)).length,
  });

  // ---------- 7. HSE Checklists (Inspection with module=SAFETY) ----------
  const hse = await prisma.inspection.findMany({
    where: { projectId: pid, deletedAt: null, module: "SAFETY" },
    select: { createdAt: true, idempotencyKey: true, filledById: true },
  });
  rows.push({
    surface: "HSE Checklists",
    all: hse.length,
    d30: hse.filter((i) => i.createdAt >= d30).length,
    d7: hse.filter((i) => i.createdAt >= d7).length,
    real: hse.filter((i) => !isColab(i.idempotencyKey) && !isAdmin(i.filledById)).length,
  });

  // ---------- 8. QAQC Inspections (WIRs) ----------
  const qaqc = await prisma.inspection.findMany({
    where: { projectId: pid, deletedAt: null, OR: [{ module: "QAQC" }, { module: null }] },
    select: { createdAt: true, idempotencyKey: true, filledById: true },
  });
  rows.push({
    surface: "QAQC Inspections (WIRs)",
    all: qaqc.length,
    d30: qaqc.filter((i) => i.createdAt >= d30).length,
    d7: qaqc.filter((i) => i.createdAt >= d7).length,
    real: qaqc.filter((i) => !isColab(i.idempotencyKey) && !isAdmin(i.filledById)).length,
  });

  // ---------- 9. Observations (Issues) ----------
  const issues = await prisma.issue.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { createdAt: true, createdById: true },
  });
  rows.push({
    surface: "Observations (Issues)",
    all: issues.length,
    d30: issues.filter((i) => i.createdAt >= d30).length,
    d7: issues.filter((i) => i.createdAt >= d7).length,
    real: issues.filter((i) => !isAdmin(i.createdById)).length,
  });

  // ---------- Print table ----------
  console.log(`\nProject: ${project.name}`);
  console.log(`As of: ${now.toISOString().slice(0, 16).replace("T", " ")} UTC\n`);
  console.log(`Surface                            |   All |  30d |   7d | Real site team`);
  console.log(`-----------------------------------|-------|------|------|---------------`);
  for (const r of rows) {
    console.log(`${r.surface.padEnd(35, " ")}| ${fmt(r.all)}| ${fmt(r.d30, 5)}| ${fmt(r.d7, 5)}| ${fmt(r.real, 5)}`);
  }

  console.log(`\n"Real site team" excludes rows from Colab import (idempotencyKey starts "colab")`);
  console.log(`and rows created by any ADMIN account. Dormant surfaces are the ones to chase.`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
