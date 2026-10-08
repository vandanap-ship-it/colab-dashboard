/**
 * Read-only audit of Siddhi production data. Walks the major modules
 * (progress, WBS rollups, labour, hindrances, permits, inductions,
 * users) and reports every row that violates an invariant or looks
 * suspicious. Grouped by severity so the on-call can triage in order.
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx tsx scripts/audit-dashboard.ts
 *
 * Safe to run against prod. Prints to stdout; writes nothing.
 */

import { TRADES } from "../src/lib/manpower";

type Severity = "BLOCKER" | "WARN" | "INFO";

interface Finding {
  severity: Severity;
  check: string;
  detail: string;
}

const findings: Finding[] = [];
function flag(severity: Severity, check: string, detail: string) {
  findings.push({ severity, check, detail });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const { prisma } = await import("../src/lib/prisma");

  const project = await prisma.project.findFirst({
    where: { name: "Amanvana" },
    select: { id: true, name: true },
  });
  if (!project) throw new Error("Project Amanvana not found");
  console.log(`Auditing: ${project.name} (${project.id})`);
  console.log();

  // --------------------------------------------------------------
  // VILLAS — 95 expected
  // --------------------------------------------------------------
  const villas = await prisma.villa.findMany({
    where: { projectId: project.id },
    select: { id: true, number: true, label: true, unitCount: true, inScope: true },
    orderBy: { number: "asc" },
  });
  const inScope = villas.filter((v) => v.inScope);
  const units = inScope.reduce((s, v) => s + (v.unitCount ?? 1), 0);
  console.log(`VILLAS: ${villas.length} rows · ${inScope.length} in-scope · ${units} units`);
  if (units !== 95) flag("WARN", "villa count", `In-scope unit count is ${units} (expected 95).`);

  const villaById = new Map(villas.map((v) => [v.id, v]));

  // --------------------------------------------------------------
  // PROGRESS ENTRIES
  // --------------------------------------------------------------
  const progress = await prisma.progressEntry.findMany({
    where: { projectId: project.id, status: "PUBLISHED", deletedAt: null },
    include: {
      wbsNode: { select: { name: true, totalQuantity: true, villaId: true, percentComplete: true } },
      contractor: { select: { name: true } },
      labour: true,
    },
  });
  console.log(`PROGRESS: ${progress.length} PUBLISHED rows (not soft-deleted)`);

  // 1. Over-count — cumulative > totalQuantity * 1.001 tolerance
  const overCount = progress.filter((p) =>
    p.wbsNode?.totalQuantity && p.wbsNode.totalQuantity > 0 &&
    p.cumulativeQuantity > p.wbsNode.totalQuantity * 1.001
  );
  if (overCount.length) {
    const sample = overCount.slice(0, 10).map((p) => {
      const v = villaById.get(p.wbsNode?.villaId ?? "");
      const pct = Math.round((p.cumulativeQuantity / (p.wbsNode?.totalQuantity ?? 1)) * 1000) / 10;
      return `  V${v?.number ?? "?"} ${p.wbsNode?.name ?? "?"} · ${p.cumulativeQuantity}/${p.wbsNode?.totalQuantity} = ${pct}% · ${p.displayId ?? p.id}`;
    });
    flag("BLOCKER", "progress over-count",
      `${overCount.length} entries have cumulative > totalQuantity. First ${sample.length}:\n${sample.join("\n")}`);
  }

  // 2. Negative values
  const negCum = progress.filter((p) => p.cumulativeQuantity < 0 || p.achievedQuantity < 0);
  if (negCum.length) flag("BLOCKER", "progress negative", `${negCum.length} entries with negative achieved or cumulative.`);

  // 3. Duplicates — same wbsNode + same date + same createdBy
  const dupKey = new Map<string, number>();
  for (const p of progress) {
    const k = `${p.wbsNodeId}__${p.date.toISOString().slice(0, 10)}__${p.createdById}`;
    dupKey.set(k, (dupKey.get(k) ?? 0) + 1);
  }
  const dups = Array.from(dupKey.entries()).filter(([, c]) => c > 1);
  if (dups.length) flag("WARN", "progress duplicate same-day",
    `${dups.length} activity+date+author combinations have >1 PUBLISHED progress entry. May be two edits in one day.`);

  // 4. Draft entries older than 7 days (abandoned)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const staleDrafts = await prisma.progressEntry.count({
    where: { projectId: project.id, status: "DRAFT", deletedAt: null, createdAt: { lt: sevenDaysAgo } },
  });
  if (staleDrafts) flag("INFO", "stale drafts", `${staleDrafts} progress drafts older than 7 days — likely abandoned.`);

  // 5. Progress cumulative monotonicity — a PUBLISHED entry whose cumulative
  //    is lower than the max cumulative of prior PUBLISHED entries on the
  //    same activity. After today's monotonic-lock removal, this is only
  //    informational (reductions are allowed with a note).
  const perActivity = new Map<string, typeof progress>();
  for (const p of progress) {
    const arr = perActivity.get(p.wbsNodeId) ?? [];
    arr.push(p);
    perActivity.set(p.wbsNodeId, arr);
  }
  let reductionCount = 0;
  const reductionSample: string[] = [];
  for (const arr of perActivity.values()) {
    const sorted = arr.slice().sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
    let max = 0;
    for (const p of sorted) {
      if (p.cumulativeQuantity < max) {
        reductionCount++;
        if (reductionSample.length < 8) {
          const v = villaById.get(p.wbsNode?.villaId ?? "");
          reductionSample.push(`  V${v?.number ?? "?"} ${p.wbsNode?.name ?? "?"} · ${p.date.toISOString().slice(0, 10)} · ${p.cumulativeQuantity} (prior max ${max}) · note="${(p.notes ?? p.reasonNote ?? "").slice(0, 60)}"`);
        }
      }
      max = Math.max(max, p.cumulativeQuantity);
    }
  }
  if (reductionCount) flag("INFO", "progress reductions",
    `${reductionCount} PUBLISHED entries sit below the prior cumulative max (allowed after today's lock removal, but spot-check these have an explanation note):\n${reductionSample.join("\n")}`);

  // --------------------------------------------------------------
  // WBS ROLLUP INVARIANTS
  // --------------------------------------------------------------
  const wbs = await prisma.wBSNode.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      name: true,
      villaId: true,
      totalQuantity: true,
      percentComplete: true,
      progressEntered: true,
      actualStart: true,
      actualFinish: true,
    },
  });
  console.log(`WBS NODES: ${wbs.length}`);

  const closedNoDate = wbs.filter((n) => (n.percentComplete ?? 0) >= 100 && !n.actualFinish);
  if (closedNoDate.length)
    flag("BLOCKER", "wbs pct=100 no actualFinish",
      `${closedNoDate.length} activities at 100% have no actualFinish stamped — Dashboard will show them open.`);

  const dateNoPct = wbs.filter((n) => n.actualFinish && (n.percentComplete ?? 0) < 100);
  if (dateNoPct.length)
    flag("WARN", "wbs actualFinish without pct=100",
      `${dateNoPct.length} activities have actualFinish stamped but % < 100 — a reduction after a close.`);

  const startNoDate = wbs.filter((n) => n.progressEntered && !n.actualStart);
  if (startNoDate.length)
    flag("WARN", "wbs progress logged, no actualStart",
      `${startNoDate.length} activities have progress but no actualStart stamp.`);

  const zeroTotalWithProgress = wbs.filter((n) => n.progressEntered && (!n.totalQuantity || n.totalQuantity <= 0));
  if (zeroTotalWithProgress.length)
    flag("WARN", "wbs progress on zero-total activity",
      `${zeroTotalWithProgress.length} activities have progress but totalQuantity is 0 or null — % cannot be computed.`);

  // --------------------------------------------------------------
  // CONTRACTOR — stale "Elegant Construction" (singular) refs
  // --------------------------------------------------------------
  const elegantSing = await prisma.contractor.count({
    where: { projectId: project.id, name: "Elegant Construction" },
  });
  if (elegantSing) flag("BLOCKER", "elegant singular ghost",
    `${elegantSing} contractor rows named "Elegant Construction" (singular) still exist — today's merge should have deleted them.`);

  const contractors = await prisma.contractor.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`CONTRACTORS: ${contractors.length}`);
  const emptyName = contractors.filter((c) => !c.name?.trim());
  if (emptyName.length) flag("WARN", "contractor empty name", `${emptyName.length} contractors with empty / whitespace name.`);

  // --------------------------------------------------------------
  // LABOUR / MANPOWER
  // --------------------------------------------------------------
  const manpower = await prisma.manpowerEntry.findMany({
    where: { projectId: project.id },
    select: { id: true, trade: true, actualCount: true, contractorId: true, entryDate: true },
  });
  console.log(`MANPOWER: ${manpower.length} entries`);

  const canonicalTrades = new Set<string>(TRADES);
  const unknownTrades = manpower.filter((m) => !canonicalTrades.has(m.trade));
  if (unknownTrades.length) {
    const bucket = new Map<string, number>();
    for (const m of unknownTrades) bucket.set(m.trade, (bucket.get(m.trade) ?? 0) + 1);
    const list = Array.from(bucket.entries()).map(([t, n]) => `  "${t}" × ${n}`).join("\n");
    flag("WARN", "manpower unknown trade",
      `${unknownTrades.length} entries with trade not in canonical list:\n${list}`);
  }

  const noContractor = manpower.filter((m) => !m.contractorId);
  if (noContractor.length)
    flag("WARN", "manpower no contractor",
      `${noContractor.length} manpower rows have no contractorId — won't show in per-contractor rollups.`);

  const negativeLabour = manpower.filter((m) => m.actualCount < 0 || m.actualCount > 500);
  if (negativeLabour.length)
    flag("BLOCKER", "manpower implausible count",
      `${negativeLabour.length} rows with count < 0 or > 500. First 5:\n${negativeLabour.slice(0, 5).map((m) => `  ${m.entryDate.toISOString().slice(0, 10)} · trade=${m.trade} · count=${m.actualCount}`).join("\n")}`);

  // --------------------------------------------------------------
  // HINDRANCE / ISSUE — villa consistency
  // --------------------------------------------------------------
  const issues = await prisma.issue.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true, villaId: true, wbsNode: { select: { villaId: true } } },
  });
  const issueMismatch = issues.filter(
    (i) => i.villaId && i.wbsNode?.villaId && i.villaId !== i.wbsNode.villaId,
  );
  console.log(`ISSUES / OBSERVATIONS: ${issues.length}`);
  if (issueMismatch.length) flag("WARN", "issue villa mismatch",
    `${issueMismatch.length} issues have villaId that disagrees with wbsNode.villaId.`);

  // --------------------------------------------------------------
  // PERMITS — status consistency
  // --------------------------------------------------------------
  const permits = await prisma.workPermit.findMany({
    where: { projectId: project.id },
    select: { id: true, displayId: true, status: true, workDate: true, closedAt: true, approvedAt: true, type: true },
  });
  console.log(`PERMITS: ${permits.length}`);

  const today = new Date();
  const pendingPast = permits.filter((p) => p.status === "PENDING" && p.workDate < today);
  if (pendingPast.length)
    flag("WARN", "permit pending past workDate",
      `${pendingPast.length} permits still PENDING whose workDate has passed — forgotten approvals.`);

  const closedNoClosedAt = permits.filter((p) => p.status === "CLOSED" && !p.closedAt);
  if (closedNoClosedAt.length)
    flag("WARN", "permit closed no closedAt",
      `${closedNoClosedAt.length} permits marked CLOSED but no closedAt timestamp.`);

  const approvedNoApprovedAt = permits.filter((p) => (p.status === "APPROVED" || p.status === "CLOSED") && !p.approvedAt);
  if (approvedNoApprovedAt.length)
    flag("WARN", "permit approved no approvedAt",
      `${approvedNoApprovedAt.length} permits in APPROVED/CLOSED state have no approvedAt.`);

  // --------------------------------------------------------------
  // SAFETY INDUCTION — expired still active
  // --------------------------------------------------------------
  const inductions = await prisma.safetyInduction.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true, workerName: true, status: true, expiryDate: true },
  });
  console.log(`SAFETY INDUCTIONS: ${inductions.length}`);
  const expiredActive = inductions.filter((s) => s.status === "ACTIVE" && s.expiryDate < today);
  if (expiredActive.length)
    flag("WARN", "induction expired but active",
      `${expiredActive.length} inductions past expiryDate but still ACTIVE.`);

  const noExpiry = inductions.filter((s) => !s.expiryDate);
  if (noExpiry.length) flag("WARN", "induction no expiry", `${noExpiry.length} inductions have no expiryDate.`);

  // --------------------------------------------------------------
  // USERS
  // --------------------------------------------------------------
  const users = await prisma.user.findMany({
    where: {},
    select: { id: true, email: true, name: true, modules: true, role: true },
  });
  console.log(`USERS: ${users.length}`);

  const emailBucket = new Map<string, number>();
  for (const u of users) if (u.email) emailBucket.set(u.email.toLowerCase(), (emailBucket.get(u.email.toLowerCase()) ?? 0) + 1);
  const dupEmails = Array.from(emailBucket.entries()).filter(([, c]) => c > 1);
  if (dupEmails.length)
    flag("BLOCKER", "user duplicate email",
      `${dupEmails.length} duplicate email addresses: ${dupEmails.map(([e, c]) => `${e}×${c}`).join(", ")}`);

  const noModules = users.filter((u) => !u.modules || u.modules.trim() === "");
  if (noModules.length) flag("INFO", "user no modules",
    `${noModules.length} users have no modules set (contractor-only roles may be legitimate).`);

  // --------------------------------------------------------------
  // Done — print summary
  // --------------------------------------------------------------
  console.log();
  console.log(`============================================`);
  console.log(`AUDIT COMPLETE · ${findings.length} findings`);
  console.log(`============================================`);
  for (const sev of ["BLOCKER", "WARN", "INFO"] as const) {
    const subset = findings.filter((f) => f.severity === sev);
    if (!subset.length) continue;
    console.log(`\n[${sev}] (${subset.length})`);
    for (const f of subset) {
      console.log(`\n  ${f.check}`);
      console.log(`    ${f.detail.replace(/\n/g, "\n    ")}`);
    }
  }
  if (findings.length === 0) {
    console.log(`\nAll checks passed. Nothing to flag.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
