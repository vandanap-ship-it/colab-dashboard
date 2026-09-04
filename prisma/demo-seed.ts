/**
 * Demo seed — populates the Amanvana project with realistic data so the
 * dashboard, charts and reports actually have shape during testing.
 *
 * Idempotent: wipes prior demo records (WBS / progress / issues / hindrances /
 * concerns / inspections) and re-inserts. Users + project metadata + contractors
 * are left alone.
 *
 * Run:  npx tsx prisma/demo-seed.ts
 *
 * Production lockout: this script refuses to run unless NODE_ENV is "development"
 * or the operator passes ALLOW_DEMO_SEED=1. It would otherwise wipe and replace
 * a customer's real WBS data.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error(
    "Refusing to run demo seed in production. Set ALLOW_DEMO_SEED=1 if you really mean to wipe project data.",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (Postgres connection string)");

// Belt-and-suspenders: if the URL host is a Neon endpoint, refuse regardless
// of NODE_ENV. The NODE_ENV guard above catches the deploy-time case; this
// catches the "someone ran it locally against the prod URL" case where
// NODE_ENV might not be set. If you actually want to run demo-seed against
// a Neon BRANCH (never production main), set ALLOW_DEMO_SEED=1.
if (/neon\.tech/i.test(url) && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error(
    "Refusing to run demo seed: DATABASE_URL points at a Neon host. This\n" +
    "script wipes and re-inserts WBS + progress + issues + hindrances +\n" +
    "concerns + inspections. Set ALLOW_DEMO_SEED=1 only if you have\n" +
    "double-checked the target is a Neon branch, not production main.",
  );
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Deterministic PRNG so reruns produce stable output.
let rngState = 0xC01AB015;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0xffffffff;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
function days(n: number): number { return n * 86_400_000; }
function addDays(d: Date, n: number): Date { return new Date(d.getTime() + days(n)); }
function rint(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

const PHASES = [
  { name: "Vaayu", durationDays: 22, color: "Plumbing" },
  { name: "Bhoomi", durationDays: 22, color: "MS Fabrication" },
  { name: "Landscape", durationDays: 48, color: "External Development" },
  { name: "Waterbody", durationDays: 53, color: "Plumbing" },
  { name: "Development", durationDays: 157, color: "External Development" },
  { name: "FLAP", durationDays: 55, color: "Finishing" },
];

const FLOORS_PER_PHASE: Record<string, string[]> = {
  Vaayu: ["Front Yard", "Family Living", "Master Bedroom"],
  Bhoomi: ["Backyard - Garden", "Garden Bedroom", "Living Room"],
  Landscape: ["Stone Pathway", "Tree Plantation"],
  Waterbody: ["Reflection Pool", "Cascade Wall"],
  Development: ["Phase A", "Phase B", "Phase C"],
  FLAP: ["Surface Grinding", "Preliminary Painting", "Final Polish"],
};

// activity templates: name + unit + total qty + which contractor category fits
const ACTIVITY_TEMPLATES: Array<{
  name: string;
  unit: string;
  qty: [number, number]; // min, max total quantity
  contractorCategory: string;
}> = [
  { name: "Plumbing-Testing & Commissioning", unit: "Nos", qty: [10, 40], contractorCategory: "Plumbing" },
  { name: "Plumbing-Irrigation Works", unit: "m", qty: [60, 200], contractorCategory: "Plumbing" },
  { name: "Plumbing-CP Fixtures & Closures", unit: "Nos", qty: [10, 40], contractorCategory: "Plumbing" },
  { name: "MS Fabrication-Glass Installation", unit: "Sqft", qty: [120, 400], contractorCategory: "MS Fabrication" },
  { name: "MS Fabrication-Surface Grinding", unit: "Sqft", qty: [200, 600], contractorCategory: "MS Fabrication" },
  { name: "Interior Carpentry-Walkin Wardrobe Shutters", unit: "Sqft", qty: [80, 250], contractorCategory: "Carpentry" },
  { name: "Interior Carpentry-Shelves Shutters", unit: "Sqft", qty: [60, 200], contractorCategory: "Carpentry" },
  { name: "Interior Carpentry-Final Patch", unit: "Sqft", qty: [40, 150], contractorCategory: "Carpentry" },
  { name: "Painting-Putty & Primer", unit: "Sqft", qty: [800, 1500], contractorCategory: "Finishing" },
  { name: "Painting-Final Coat", unit: "Sqft", qty: [800, 1500], contractorCategory: "Finishing" },
  { name: "External-Stone Cladding", unit: "Sqft", qty: [400, 1200], contractorCategory: "External Development" },
  { name: "External-Pathway Laying", unit: "Sqft", qty: [400, 1200], contractorCategory: "External Development" },
  { name: "External-Tree Plantation", unit: "Nos", qty: [10, 60], contractorCategory: "External Development" },
];

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

const ISSUE_DESCS = [
  "Wall not in plumb at junction",
  "Shutter alignment off by 5mm",
  "Tile grout uneven near drain",
  "Paint patch visible after dry",
  "Pipe joint leaking under pressure",
  "Door frame chipped during install",
  "Floor level deviation 8mm",
  "Window glass scratched",
  "Conduit broken behind drywall",
  "Light fitting flickering",
  "Wood finish below spec",
  "Reinforcement cover insufficient",
  "Plaster cracking near beam",
  "Drainage slope inadequate",
  "Sealant joint discontinuous",
];

const HINDRANCE_DESCS = [
  "Material delivery delayed by supplier",
  "Heavy rainfall — outdoor work paused",
  "Approval pending from architect",
  "Power outage in block",
  "Skilled labour shortage",
  "Transport strike affecting deliveries",
  "Site access blocked for inspection",
  "Equipment breakdown — backup awaited",
];

const CONCERN_DESCS = [
  "Coordination needed between MEP and finishing teams",
  "Quality of material supplied appears below spec",
  "Activity sequence needs revision per architect",
  "Storage space at site is becoming tight",
  "Subcontractor pace needs ramp-up",
  "Drawing revision conflicts with executed work",
  "Photo documentation incomplete for last week",
  "Waste disposal frequency needs review",
  "Scaffolding removal timeline unclear",
  "Handover sequence to interior team needs sync",
];

const INSPECTION_TITLES = [
  "Plumbing rough-in pressure test",
  "Floor screed level check",
  "Door frame plumb verification",
  "Paint coverage and finish",
  "Glass installation alignment",
  "Carpentry shutter clearance",
  "Reinforcement spacing audit",
  "External cladding pattern",
  "Tile joint width consistency",
  "Conduit routing per drawing",
  "Sealant continuity check",
  "Final clean and handover prep",
];

const ISSUE_CATEGORIES = [
  "Not in plumb",
  "Not to level",
  "Workmanship below spec",
  "Material not as spec",
  "Cracks",
  "Surface finish defect",
  "Wrong dimension",
  "Violation of procedure",
];

async function main() {
  console.log("→ Loading Amanvana project + contractors + users…");

  const project = await prisma.project.findFirst({ where: { name: "Amanvana" } });
  if (!project) {
    console.error("Run `npx prisma db seed` first to create the Amanvana project.");
    process.exit(1);
  }

  const contractors = await prisma.contractor.findMany({ where: { projectId: project.id } });
  if (contractors.length === 0) {
    console.error("No contractors. Run `npx prisma db seed` first.");
    process.exit(1);
  }
  const contractorByCategory = new Map<string, (typeof contractors)[number]>(
    contractors.map((c) => [c.category, c]),
  );

  const users = await prisma.user.findMany();
  const admin = users.find((u) => u.username === "admin")!;
  const planner = users.find((u) => u.username === "planner")!;
  const engineer = users.find((u) => u.username === "engineer")!;
  const manager = users.find((u) => u.username === "manager")!;

  // Tagline for the project (used by branded reports later)
  if (!project.tagline) {
    await prisma.project.update({
      where: { id: project.id },
      data: { tagline: "HOME OF SANCTUARIES · AMANVANA" },
    });
  }

  console.log("→ Wiping prior demo data (cascades through photos/labour/items)…");
  await prisma.inspection.deleteMany({ where: { projectId: project.id } });
  await prisma.concern.deleteMany({ where: { projectId: project.id } });
  await prisma.issue.deleteMany({ where: { projectId: project.id } });
  await prisma.hindrance.deleteMany({ where: { projectId: project.id } });
  await prisma.progressEntry.deleteMany({ where: { projectId: project.id } });
  await prisma.wBSNode.deleteMany({ where: { projectId: project.id } });

  // --------- WBS tree ---------
  console.log("→ Building WBS tree (Project → Phase → Floor → Activity)…");

  const projectStart = new Date("2025-09-16");
  const today = new Date();

  const projectRoot = await prisma.wBSNode.create({
    data: {
      projectId: project.id,
      taskCode: "AMV",
      name: "Amanvana",
      level: 0,
      orderIndex: 0,
      baselineStart: projectStart,
      baselineFinish: new Date("2026-02-20"),
      percentComplete: 70,
    },
  });

  const leafActivityRecords: Array<{
    id: string;
    name: string;
    phaseName: string;
    floorName: string;
    contractorId: string | null;
    totalQuantity: number;
    unit: string;
    cumulativeQty: number;
    percentComplete: number;
  }> = [];

  let phaseOrder = 0;
  for (const phase of PHASES) {
    phaseOrder += 1;
    const phaseStart = projectStart;
    const phaseFinish = addDays(phaseStart, phase.durationDays);

    const phaseNode = await prisma.wBSNode.create({
      data: {
        projectId: project.id,
        parentId: projectRoot.id,
        taskCode: `AMV.${phaseOrder}`,
        name: phase.name,
        level: 1,
        orderIndex: phaseOrder,
        baselineStart: phaseStart,
        baselineFinish: phaseFinish,
        actualStart: phaseStart,
        projectedFinish: addDays(phaseFinish, rint(0, 60)),
        percentComplete: 0, // computed from children, but we set a value so charts have something
      },
    });

    let floorOrder = 0;
    for (const floorName of FLOORS_PER_PHASE[phase.name] ?? []) {
      floorOrder += 1;
      const floorNode = await prisma.wBSNode.create({
        data: {
          projectId: project.id,
          parentId: phaseNode.id,
          taskCode: `AMV.${phaseOrder}.${floorOrder}`,
          name: floorName,
          level: 2,
          orderIndex: floorOrder,
          baselineStart: phaseStart,
          baselineFinish: phaseFinish,
        },
      });

      const activityCount = rint(2, 5);
      const templates = [...ACTIVITY_TEMPLATES].sort(() => rand() - 0.5).slice(0, activityCount);

      let actOrder = 0;
      for (const tpl of templates) {
        actOrder += 1;
        const totalQty = rint(tpl.qty[0], tpl.qty[1]);
        const pct = Math.round(rand() * 100);
        const cumQty = Math.round((pct / 100) * totalQty);
        const dur = rint(10, Math.max(11, phase.durationDays - 5));
        const actStart = addDays(phaseStart, rint(0, Math.max(1, phase.durationDays - dur)));
        const actFinish = addDays(actStart, dur);
        const projectedFinish = addDays(actFinish, rint(0, 30));
        const contractor = contractorByCategory.get(tpl.contractorCategory) ?? contractors[0];
        const reasonForDelay =
          projectedFinish > actFinish && rand() > 0.5
            ? pick([
                "Material delivery delay",
                "Pending architect approval",
                "Weather impact",
                "Sequencing change",
                "Manpower shortage",
              ])
            : null;

        const created = await prisma.wBSNode.create({
          data: {
            projectId: project.id,
            parentId: floorNode.id,
            taskCode: `AMV.${phaseOrder}.${floorOrder}.${actOrder}`,
            name: tpl.name,
            level: 3,
            orderIndex: actOrder,
            baselineStart: actStart,
            baselineFinish: actFinish,
            actualStart: actStart,
            actualFinish: pct >= 100 ? actFinish : null,
            projectedFinish,
            percentComplete: pct,
            totalQuantity: totalQty,
            unit: tpl.unit,
            contractorId: contractor.id,
            delayReason: reasonForDelay,
          },
        });
        leafActivityRecords.push({
          id: created.id,
          name: tpl.name,
          phaseName: phase.name,
          floorName,
          contractorId: contractor.id,
          totalQuantity: totalQty,
          unit: tpl.unit,
          cumulativeQty: cumQty,
          percentComplete: pct,
        });
      }
    }
  }

  console.log(`   ✓ ${leafActivityRecords.length} leaf activities created`);

  // --------- Progress entries (last 14 days) ---------
  console.log("→ Generating 14 days of progress entries…");
  let progressCount = 0;
  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const day = addDays(today, -dayOffset);
    const entriesForDay = rint(5, 10);

    for (let i = 0; i < entriesForDay; i++) {
      const act = pick(leafActivityRecords);
      const dailyAchieved = Math.round(rand() * (act.totalQuantity * 0.05));
      const newCum = Math.min(act.totalQuantity, act.cumulativeQty + dailyAchieved);

      const entry = await prisma.progressEntry.create({
        data: {
          projectId: project.id,
          wbsNodeId: act.id,
          date: day,
          type: pick(["LABOUR_SUPPLY", "LABOUR_SUPPLY", "PRW"]),
          achievedQuantity: dailyAchieved,
          cumulativeQuantity: newCum,
          contractorId: act.contractorId,
          createdById: pick([engineer.id, manager.id]),
          notes: rand() > 0.7 ? pick(["Output below plan today", "Good pace, on track", "Minor delay due to material wait"]) : null,
          labour: {
            create: range(rint(2, 5)).map(() => ({
              category: pick(LABOUR_CATEGORIES),
              count: rint(1, 8),
            })),
          },
        },
      });

      progressCount += 1;
      act.cumulativeQty = newCum;

      // Some entries get photo placeholder URLs (we won't actually upload)
      if (rand() > 0.6) {
        await prisma.progressPhoto.create({
          data: {
            progressEntryId: entry.id,
            url: `https://picsum.photos/seed/${entry.id}/640/480`,
          },
        });
      }
    }
  }
  console.log(`   ✓ ${progressCount} progress entries logged`);

  // --------- Issues ---------
  console.log("→ Generating issues…");
  const issueCount = 15;
  let resolved = 0;
  for (let i = 0; i < issueCount; i++) {
    const act = pick(leafActivityRecords);
    const status = rand() < 0.55 ? "OPEN" : "RESOLVED";
    if (status === "RESOLVED") resolved += 1;
    await prisma.issue.create({
      data: {
        projectId: project.id,
        wbsNodeId: act.id,
        description: pick(ISSUE_DESCS),
        severity: pick(["LOW", "MEDIUM", "HIGH"]),
        category: rand() < 0.7 ? pick(ISSUE_CATEGORIES) : null,
        status,
        createdById: pick([engineer.id, manager.id]),
        assignedToId: rand() < 0.5 ? pick([engineer.id, manager.id, planner.id]) : null,
        createdAt: addDays(today, -rint(0, 14)),
      },
    });
  }
  console.log(`   ✓ ${issueCount} issues (${resolved} resolved)`);

  // --------- Hindrances ---------
  console.log("→ Generating hindrances…");
  const hindranceCount = 8;
  let resolvedH = 0;
  for (let i = 0; i < hindranceCount; i++) {
    const act = pick(leafActivityRecords);
    const status = rand() < 0.5 ? "OPEN" : "RESOLVED";
    if (status === "RESOLVED") resolvedH += 1;
    const start = addDays(today, -rint(1, 18));
    await prisma.hindrance.create({
      data: {
        projectId: project.id,
        wbsNodeId: act.id,
        description: pick(HINDRANCE_DESCS),
        startDate: start,
        resolvedDate: status === "RESOLVED" ? addDays(start, rint(1, 8)) : null,
        daysImpact: rint(1, 12),
        status,
        createdById: pick([engineer.id, manager.id]),
        createdAt: start,
      },
    });
  }
  console.log(`   ✓ ${hindranceCount} hindrances (${resolvedH} resolved)`);

  // --------- Concerns ---------
  console.log("→ Generating concerns…");
  const concernStatuses = ["PENDING", "READ", "TASK_ASSIGNED", "RESOLVED"];
  const concernCount = 10;
  for (let i = 0; i < concernCount; i++) {
    const act = pick(leafActivityRecords);
    const status = pick(concernStatuses);
    await prisma.concern.create({
      data: {
        projectId: project.id,
        wbsNodeId: act.id,
        description: pick(CONCERN_DESCS),
        status,
        raisedById: pick([engineer.id, manager.id]),
        assignedToId:
          status === "TASK_ASSIGNED" || rand() > 0.5 ? pick([engineer.id, manager.id, planner.id]) : null,
        createdAt: addDays(today, -rint(0, 12)),
      },
    });
  }
  console.log(`   ✓ ${concernCount} concerns`);

  // --------- Inspections ---------
  console.log("→ Generating inspections…");
  const inspectionCount = 12;
  let passed = 0, rejected = 0, inReview = 0;
  for (let i = 0; i < inspectionCount; i++) {
    const act = pick(leafActivityRecords);
    const r = rand();
    let status: string;
    if (r < 0.42) { status = "IN_REVIEW"; inReview += 1; }
    else if (r < 0.83) { status = "PASSED"; passed += 1; }
    else { status = "REJECTED"; rejected += 1; }

    await prisma.inspection.create({
      data: {
        projectId: project.id,
        wbsNodeId: act.id,
        title: pick(INSPECTION_TITLES),
        status,
        rejectionReason: status === "REJECTED" ? pick([
          "Tile spacing not as spec",
          "Joint sealant discontinuous",
          "Surface finish defect",
        ]) : null,
        filledById: engineer.id,
        reviewedById: status === "IN_REVIEW" ? null : planner.id,
        reviewedAt: status === "IN_REVIEW" ? null : addDays(today, -rint(0, 8)),
        createdAt: addDays(today, -rint(0, 14)),
        items: {
          create: [
            "Dimensions to drawing",
            "Surface finish acceptable",
            "Materials as specified",
            "Workmanship per standard",
            "Safety provisions in place",
          ].map((label, j) => ({
            label,
            passed: status === "REJECTED" && j === rint(0, 4) ? false : rand() < 0.85,
            notes: status === "REJECTED" && j === 0 ? "Failed — see rejection notes" : null,
            orderIndex: j,
          })),
        },
      },
    });
  }
  console.log(`   ✓ ${inspectionCount} inspections (${inReview} in review · ${passed} passed · ${rejected} rejected)`);

  // --------- Recompute project + phase rollups ---------
  console.log("→ Updating project root percent complete from leaves…");
  const avg =
    leafActivityRecords.reduce((s, a) => s + a.percentComplete, 0) / leafActivityRecords.length;
  await prisma.wBSNode.update({
    where: { id: projectRoot.id },
    data: { percentComplete: Math.round(avg) },
  });

  console.log("\n✅ Demo seed complete. Sign in as `planner` (password `password`) to see the result.");
  // Use _ prefix to silence linter on intentionally-unused var
  const _admin = admin;
  return _admin;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
