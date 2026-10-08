/**
 * Master data export for a date range. Dumps every record Siddhi holds
 * for that window (progress, manpower, hindrances, permits, inspections,
 * issues, safety inductions) as CSVs plus the aggregated WeeklyReport
 * payload as JSON. Use this when the live weekly report page is
 * misbehaving and you want the raw data to drop straight into the
 * Sep 21-27 PDF template.
 *
 *   DATABASE_URL="postgresql://..." \
 *   FROM=2026-10-01 TO=2026-10-07 \
 *   npx tsx scripts/master-export.ts
 *
 * Defaults: FROM=2026-10-01 TO=2026-10-07 (the 1-7 Oct week).
 *
 * Writes to ~/Downloads/siddhi-master-<FROM>_to_<TO>/ with:
 *   00-README.txt              - index of files
 *   01-overall.txt             - project % summary
 *   02-progress.csv            - every PUBLISHED progress entry
 *   03-manpower.csv            - every manpower entry (contractor x trade x day)
 *   04-manpower-pivot.csv      - the same pivoted contractor x trade x day
 *   05-hindrances.csv          - hindrances raised in window
 *   06-permits.csv             - permits raised in window
 *   07-inspections.csv         - WIR / QAQC / safety checklists
 *   08-issues.csv              - observations / issues raised in window
 *   09-safety-inductions.csv   - inductions raised in window
 *   10-weekly-aggregate.json   - full WeeklyReport payload for the window
 *
 * Read-only. Safe against prod.
 */

import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type Row = Record<string, unknown>;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    rows.reduce((set, r) => {
      for (const k of Object.keys(r)) set.add(k);
      return set;
    }, new Set<string>())
  );
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

function fmtDay(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}
function fmtDt(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const fromStr = process.env.FROM ?? "2026-10-01";
  const toStr = process.env.TO ?? "2026-10-07";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
    throw new Error("FROM and TO must be YYYY-MM-DD");
  }

  // Half-open interval [from, toExclusive) on UTC midnights so day-7
  // records are included.
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const toExclusive = new Date(
    new Date(`${toStr}T00:00:00.000Z`).getTime() + 86400000
  );

  console.log(`Window: ${fromStr} to ${toStr} (inclusive)`);

  const { prisma } = await import("../src/lib/prisma");
  const { getWeeklyReport } = await import("../src/lib/weeklyReportServer");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found");
  console.log(`Project: ${project.name} (${project.id})`);

  const outDir = join(
    homedir(),
    "Downloads",
    `siddhi-master-${fromStr}_to_${toStr}`
  );
  mkdirSync(outDir, { recursive: true });

  // Villa lookup — WBSNode holds villaId as a scalar, not a relation,
  // so one upfront fetch keeps every CSV join cheap.
  const villas = await prisma.villa.findMany({
    where: { projectId: project.id },
    select: { id: true, number: true, label: true },
  });
  const villaById = new Map(villas.map((v) => [v.id, v]));
  const villaOf = (villaId: string | null | undefined) =>
    villaId ? villaById.get(villaId) ?? null : null;

  // ----- 02 progress -----
  const progress = await prisma.progressEntry.findMany({
    where: {
      projectId: project.id,
      status: "PUBLISHED",
      deletedAt: null,
      date: { gte: from, lt: toExclusive },
    },
    include: {
      wbsNode: {
        select: {
          name: true,
          unit: true,
          totalQuantity: true,
          villaId: true,
        },
      },
      contractor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      labour: true,
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const progressRows: Row[] = progress.map((p) => {
    const totalLabour = p.labour.reduce((sum, l) => sum + (l.count ?? 0), 0);
    const sourceColab = p.idempotencyKey?.startsWith("colab-") ? "Colab" : "Siddhi";
    const pct =
      p.wbsNode?.totalQuantity && p.wbsNode.totalQuantity > 0
        ? Math.round((p.cumulativeQuantity / p.wbsNode.totalQuantity) * 1000) / 10
        : null;
    const villa = villaOf(p.wbsNode?.villaId);
    return {
      displayId: p.displayId ?? "",
      date: fmtDay(p.date),
      villaNumber: villa?.number ?? "",
      villaLabel: villa?.label ?? "",
      activity: p.wbsNode?.name ?? "",
      unit: p.wbsNode?.unit ?? "",
      achieved: p.achievedQuantity,
      cumulative: p.cumulativeQuantity,
      totalQuantity: p.wbsNode?.totalQuantity ?? "",
      pctComplete: pct ?? "",
      contractor: p.contractor?.name ?? "",
      type: p.type,
      reasonCode: p.reasonCode ?? "",
      reasonNote: p.reasonNote ?? "",
      notes: p.notes ?? "",
      labourTotal: totalLabour,
      labourBreakdown: p.labour
        .map((l) => `${l.category}:${l.count}`)
        .join(" | "),
      enteredBy: p.createdBy?.name ?? p.createdBy?.email ?? "",
      source: sourceColab,
      createdAt: fmtDt(p.createdAt),
    };
  });
  writeFileSync(join(outDir, "02-progress.csv"), toCsv(progressRows));
  console.log(`  02-progress.csv: ${progressRows.length} rows`);

  // ----- 03 manpower (flat) -----
  const manpower = await prisma.manpowerEntry.findMany({
    where: {
      projectId: project.id,
      entryDate: { gte: from, lt: toExclusive },
    },
    include: {
      contractor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: [{ entryDate: "asc" }, { contractorId: "asc" }, { trade: "asc" }],
  });

  const manpowerRows: Row[] = manpower.map((m) => ({
    date: fmtDay(m.entryDate),
    contractor: m.contractor?.name ?? "",
    trade: m.trade,
    actualCount: m.actualCount,
    enteredBy: m.createdBy?.name ?? m.createdBy?.email ?? "",
    createdAt: fmtDt(m.createdAt),
  }));
  writeFileSync(join(outDir, "03-manpower.csv"), toCsv(manpowerRows));
  console.log(`  03-manpower.csv: ${manpowerRows.length} rows`);

  // ----- 04 manpower pivot (contractor x trade x day) -----
  const pivotMap = new Map<string, Map<string, number>>();
  const dayKeys = new Set<string>();
  for (const m of manpower) {
    const key = `${m.contractor?.name ?? "?"}__${m.trade}`;
    const day = fmtDay(m.entryDate);
    dayKeys.add(day);
    if (!pivotMap.has(key)) pivotMap.set(key, new Map());
    const inner = pivotMap.get(key)!;
    inner.set(day, (inner.get(day) ?? 0) + m.actualCount);
  }
  const days = Array.from(dayKeys).sort();
  const pivotRows: Row[] = Array.from(pivotMap.entries())
    .map(([key, inner]) => {
      const [contractor, trade] = key.split("__");
      const row: Row = { contractor, trade };
      let total = 0;
      for (const d of days) {
        const v = inner.get(d) ?? 0;
        row[d] = v;
        total += v;
      }
      row.total = total;
      return row;
    })
    .sort((a, b) => {
      const c = String(a.contractor).localeCompare(String(b.contractor));
      return c !== 0 ? c : String(a.trade).localeCompare(String(b.trade));
    });
  writeFileSync(join(outDir, "04-manpower-pivot.csv"), toCsv(pivotRows));
  console.log(`  04-manpower-pivot.csv: ${pivotRows.length} rows across ${days.length} days`);

  // ----- 05 hindrances -----
  const hindrances = await prisma.hindrance.findMany({
    where: {
      projectId: project.id,
      deletedAt: null,
      createdAt: { gte: from, lt: toExclusive },
    },
    include: {
      wbsNode: { select: { name: true, villaId: true } },
      responsibleContractor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const hindRows: Row[] = hindrances.map((h) => {
    const villa = villaOf(h.wbsNode?.villaId);
    return {
    createdAt: fmtDt(h.createdAt),
    villaNumber: villa?.number ?? "",
    villaLabel: villa?.label ?? "",
    activity: h.wbsNode?.name ?? "",
    description: h.description,
    reasonCode: h.reasonCode ?? "",
    reasonNote: h.reasonNote ?? "",
    status: h.status,
    startDate: fmtDay(h.startDate),
    endDate: fmtDay(h.endDate),
    resolvedDate: fmtDay(h.resolvedDate),
    daysImpact: h.daysImpact ?? "",
    responsibleContractor: h.responsibleContractor?.name ?? "",
    responsibleTeam: h.responsibleTeam ?? "",
    raisedBy: h.createdBy?.name ?? h.createdBy?.email ?? "",
    };
  });
  writeFileSync(join(outDir, "05-hindrances.csv"), toCsv(hindRows));
  console.log(`  05-hindrances.csv: ${hindRows.length} rows`);

  // ----- 06 permits -----
  const permits = await prisma.workPermit.findMany({
    where: {
      projectId: project.id,
      createdAt: { gte: from, lt: toExclusive },
    },
    include: {
      contractor: { select: { name: true } },
      requester: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const permitRows: Row[] = permits.map((p) => ({
    displayId: p.displayId ?? "",
    createdAt: fmtDt(p.createdAt),
    type: p.type,
    title: p.title,
    status: p.status,
    workDate: fmtDay(p.workDate),
    endDate: fmtDay(p.endDate),
    startTime: p.startTime,
    endTime: p.endTime,
    location: p.location ?? "",
    contractor: p.contractor?.name ?? "",
    requester: p.requester?.name ?? p.requester?.email ?? "",
    approvedAt: fmtDt(p.approvedAt),
    closedAt: fmtDt(p.closedAt),
    rejectedAt: fmtDt(p.rejectedAt),
    rejectionReason: p.rejectionReason ?? "",
  }));
  writeFileSync(join(outDir, "06-permits.csv"), toCsv(permitRows));
  console.log(`  06-permits.csv: ${permitRows.length} rows`);

  // ----- 07 inspections (WIR / QAQC / SAFETY) -----
  const inspections = await prisma.inspection.findMany({
    where: {
      projectId: project.id,
      deletedAt: null,
      createdAt: { gte: from, lt: toExclusive },
    },
    include: {
      wbsNode: { select: { name: true, villaId: true } },
      contractor: { select: { name: true } },
      filledBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const inspRows: Row[] = inspections.map((i) => {
    const villa = villaOf(i.wbsNode?.villaId);
    return {
      createdAt: fmtDt(i.createdAt),
      module: i.module ?? "",
      title: i.title ?? "",
      status: i.status,
      villaNumber: villa?.number ?? "",
      villaLabel: villa?.label ?? "",
      activity: i.wbsNode?.name ?? "",
      location: i.exactLocation ?? "",
      contractor: i.contractor?.name ?? "",
      filledBy: i.filledBy?.name ?? i.filledBy?.email ?? "",
      reviewedBy: i.reviewedBy?.name ?? i.reviewedBy?.email ?? "",
      reviewedAt: fmtDt(i.reviewedAt),
      triggerType: i.triggerType ?? "",
    };
  });
  writeFileSync(join(outDir, "07-inspections.csv"), toCsv(inspRows));
  console.log(`  07-inspections.csv: ${inspRows.length} rows`);

  // ----- 08 issues (observations) -----
  const issues = await prisma.issue.findMany({
    where: {
      projectId: project.id,
      deletedAt: null,
      createdAt: { gte: from, lt: toExclusive },
    },
    include: {
      wbsNode: { select: { name: true } },
      villa: { select: { number: true, label: true } },
      debitTo: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      assignedTo: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const issueRows: Row[] = issues.map((i) => ({
    createdAt: fmtDt(i.createdAt),
    category: i.category ?? "",
    severity: i.severity ?? "",
    status: i.status,
    description: i.description,
    villaNumber: i.villa?.number ?? "",
    villaLabel: i.villa?.label ?? "",
    activity: i.wbsNode?.name ?? "",
    dueDate: fmtDay(i.dueDate),
    debitTo: i.debitTo?.name ?? "",
    debitAmount: i.debitAmount ?? "",
    raisedBy: i.createdBy?.name ?? i.createdBy?.email ?? "",
    assignedTo: i.assignedTo?.name ?? i.assignedTo?.email ?? "",
  }));
  writeFileSync(join(outDir, "08-issues.csv"), toCsv(issueRows));
  console.log(`  08-issues.csv: ${issueRows.length} rows`);

  // ----- 09 safety inductions -----
  const inductions = await prisma.safetyInduction.findMany({
    where: {
      projectId: project.id,
      deletedAt: null,
      createdAt: { gte: from, lt: toExclusive },
    },
    include: {
      contractor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const indRows: Row[] = inductions.map((s) => ({
    displayId: s.displayId ?? "",
    createdAt: fmtDt(s.createdAt),
    workerName: s.workerName,
    trade: s.trade ?? "",
    contractor: s.contractor?.name ?? "",
    gender: s.gender ?? "",
    inductionDate: fmtDay(s.inductionDate),
    expiryDate: fmtDay(s.expiryDate),
    status: s.status ?? "",
    inductedBy: s.createdBy?.name ?? s.createdBy?.email ?? "",
  }));
  writeFileSync(join(outDir, "09-safety-inductions.csv"), toCsv(indRows));
  console.log(`  09-safety-inductions.csv: ${indRows.length} rows`);

  // ----- 10 weekly aggregate (JSON) -----
  // Only emits when FROM..TO is exactly a 7-day Sunday-ending window
  // the WeeklyReport builder expects; the pdf template is weekly so
  // we just always try, using TO as the weekEnding.
  const weekly = await getWeeklyReport(
    project.id,
    new Date(`${toStr}T00:00:00.000Z`)
  );
  writeFileSync(
    join(outDir, "10-weekly-aggregate.json"),
    JSON.stringify(weekly, null, 2)
  );
  console.log(`  10-weekly-aggregate.json: written`);

  // ----- 01 overall summary (txt) -----
  const overall = weekly?.overall;
  const perDay = weekly?.dataEntry ?? [];
  const siteTotal = weekly?.manpowerSiteTotal;
  const summary = [
    `Siddhi master export`,
    `Window: ${fromStr} to ${toStr}`,
    `Project: ${project.name}`,
    ``,
    `Overall project progress`,
    `  Target by ${toStr}: ${overall?.plannedPct ?? "-"}%`,
    `  Actual:              ${overall?.actualPct ?? "-"}%`,
    `  Variance:            ${overall?.variancePct ?? "-"} pp`,
    ``,
    `Totals in window`,
    `  Progress entries: ${progressRows.length}`,
    `  Manpower entries: ${manpowerRows.length}`,
    `  Hindrances raised: ${hindRows.length}`,
    `  Permits raised: ${permitRows.length}`,
    `  Inspections (QAQC/SAFETY): ${inspRows.length}`,
    `  Observations / issues: ${issueRows.length}`,
    `  Safety inductions: ${indRows.length}`,
    ``,
    `Site-wide labour`,
    `  Weekly actual: ${siteTotal?.weeklyActual ?? "-"} labour-days`,
    `  Best day: ${siteTotal?.bestDayActual ?? "-"} on ${siteTotal?.bestDayDate ?? "-"}`,
    `  Days with any entry: ${siteTotal?.loggedDays ?? "-"} of ${perDay.length}`,
    ``,
    `Delay-reason buckets`,
    ...(weekly?.delayReasons ?? []).map(
      (d) =>
        `  ${d.label.padEnd(34)} ${String(d.activityCount).padStart(4)} activities  avg ${d.avgDaysImpact}d  max ${d.maxDaysImpact}d  ${d.affectedVillas.length} villas`
    ),
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "01-overall.txt"), summary);

  // ----- 00 README -----
  const readme = [
    `Siddhi master export - ${fromStr} to ${toStr}`,
    ``,
    `Files in this folder:`,
    `  00-README.txt              this index`,
    `  01-overall.txt             site-level summary - plug into Report §1 and §4 totals`,
    `  02-progress.csv            every progress entry on the activity in this window - §2/§3`,
    `  03-manpower.csv            flat manpower rows (date x contractor x trade) - §4 raw`,
    `  04-manpower-pivot.csv      same, pivoted - drops straight into §4 trade-by-day table`,
    `  05-hindrances.csv          hindrances raised in window (none expected 1-7 Oct)`,
    `  06-permits.csv             permits raised in window (excluded from the weekly PDF)`,
    `  07-inspections.csv         WIR + QAQC + safety checklists (excluded from PDF)`,
    `  08-issues.csv              observations raised in window (excluded from PDF)`,
    `  09-safety-inductions.csv   inductions raised in window (excluded from PDF)`,
    `  10-weekly-aggregate.json   full computed weekly payload (overall %, milestones, delays, data entry)`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
  ].join("\n");
  writeFileSync(join(outDir, "00-README.txt"), readme);

  console.log(``);
  console.log(summary);
  console.log(`Files written to ${outDir}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
