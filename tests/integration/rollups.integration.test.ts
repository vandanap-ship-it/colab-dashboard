/**
 * DB-backed integration tests for the trust-critical rollup math.
 *
 * getProjectStats (dashboard) and getMasterReport (weekly report) compute the
 * headline planned/achieved % that management reads. Their pure date math is
 * unit-tested (schedule.test.ts), but the aggregation — leaf detection, the
 * tracked-vs-all denominator, delay rollup — only runs against the DB. These
 * tests build a throwaway SQLite DB from the committed prisma/schema.sql,
 * point the Prisma singleton at it, seed a hand-computable tree, and assert the
 * real functions' output.
 *
 * They also pin the *intentional* divergence the team is deciding on: the
 * dashboard averages only over started activities, the Master Report over all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fixed "now" so the planned-% ramp is deterministic.
const TODAY = new Date("2026-06-15T00:00:00Z");
const D = (iso: string) => new Date(iso + "T00:00:00Z");

let tmpDir: string;
let originalDbUrl: string | undefined;
// Loaded dynamically AFTER DATABASE_URL is repointed at the temp DB.
let prisma: typeof import("@/lib/prisma").prisma;
let getProjectStats: typeof import("@/lib/projectStats").getProjectStats;
let getMasterReport: typeof import("@/lib/reports").getMasterReport;

let projectId: string;

beforeAll(async () => {
  // 1. Build a fresh SQLite DB from the committed schema snapshot.
  tmpDir = mkdtempSync(join(tmpdir(), "siddhi-itest-"));
  const dbPath = join(tmpDir, "test.db");
  const schema = readFileSync("prisma/schema.sql", "utf8");
  const raw = new Database(dbPath);
  raw.exec(schema);
  raw.close();

  // 2. Point the Prisma singleton at it, THEN import (createClient reads the
  //    env at module-eval time).
  originalDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbPath}`;
  ({ prisma } = await import("@/lib/prisma"));
  ({ getProjectStats } = await import("@/lib/projectStats"));
  ({ getMasterReport } = await import("@/lib/reports"));

  // 3. Seed a hand-computable tree:
  //      root (L0) → phase (L1) → A, B, C (L2 leaves)
  const user = await prisma.user.create({
    data: { username: "itest", name: "Integration Test", passwordHash: "x", role: "PLANNER" },
  });
  const project = await prisma.project.create({
    data: {
      name: "Integration Project",
      createdById: user.id,
      endDate: D("2026-06-20"),
      projectedEndDate: D("2026-06-30"), // 10 days late → totalDelayDays 10
    },
  });
  projectId = project.id;

  const root = await prisma.wBSNode.create({
    data: { projectId, taskCode: "R", name: "Root", level: 0, orderIndex: 0 },
  });
  const phase = await prisma.wBSNode.create({
    data: { projectId, parentId: root.id, taskCode: "P1", name: "Phase 1", level: 1, orderIndex: 0 },
  });
  // A: baseline fully in the past as of TODAY → planned 100; achieved 80; tracked.
  await prisma.wBSNode.create({
    data: {
      projectId, parentId: phase.id, taskCode: "A", name: "A", level: 2, orderIndex: 0,
      baselineStart: D("2026-06-01"), baselineFinish: D("2026-06-11"),
      percentComplete: 80, progressEntered: true,
    },
  });
  // B: TODAY is 5 days into a 10-day window → planned 50; achieved 40; tracked.
  await prisma.wBSNode.create({
    data: {
      projectId, parentId: phase.id, taskCode: "B", name: "B", level: 2, orderIndex: 1,
      baselineStart: D("2026-06-10"), baselineFinish: D("2026-06-20"),
      percentComplete: 40, progressEntered: true,
    },
  });
  // C: not started (progressEntered false), baseline in the future → planned 0.
  await prisma.wBSNode.create({
    data: {
      projectId, parentId: phase.id, taskCode: "C", name: "C", level: 2, orderIndex: 2,
      baselineStart: D("2026-07-01"), baselineFinish: D("2026-07-10"),
      percentComplete: 0, progressEntered: false,
    },
  });

  await prisma.hindrance.create({
    data: { projectId, description: "Open blocker", startDate: D("2026-06-12"), createdById: user.id },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("getProjectStats (dashboard rollup)", () => {
  it("averages planned/achieved over STARTED leaves only", async () => {
    const stats = await getProjectStats(projectId, TODAY);
    // 3 leaves total (A, B, C); root + phase are not leaves.
    expect(stats.totalActivities).toBe(3);
    // tracked = {A, B}; planned = (100+50)/2 = 75; achieved = (80+40)/2 = 60.
    expect(stats.plannedPercent).toBe(75);
    expect(stats.achievedPercent).toBe(60);
    // project override: projectedEndDate - endDate = 10 days.
    expect(stats.totalDelayDays).toBe(10);
    expect(stats.hindranceCount).toBe(1);
  });
});

describe("getMasterReport (weekly report rollup)", () => {
  it("averages planned/achieved over ALL leaves (counts not-started as 0%)", async () => {
    const report = await getMasterReport(projectId, "", "", TODAY);
    // all leaves = {A, B, C}; planned = (100+50+0)/3 = 50; achieved = (80+40+0)/3 = 40.
    expect(report.overall.plannedPercent).toBe(50);
    expect(report.overall.achievedPercent).toBe(40);
    // Confirms the intentional divergence vs the dashboard (75 / 60 above).
    expect(report.totalActivities).toHaveLength(3);
  });
});
