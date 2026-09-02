import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  computeOverall,
  reconstructStages,
  computeMilestoneBuckets,
  computeDelayReasons,
  type ColabCsvRow,
} from "@/lib/rules/weeklyRules";

// Fixtures directory — Python-generated JSON outputs from the Amanvana
// Reporting Toolkit v14 (scripts/build_wk23.py, build_wk30.py). Every new
// weekly rule gets a test here that compares its result to the corresponding
// Python fixture. If Python and mine disagree, the test fails — no more
// re-imports to verify.
const FX = path.join(process.cwd(), "tests/fixtures/amanvana-wk");

function loadCsv(name: string): ColabCsvRow[] {
  const text = readFileSync(path.join(FX, name), "utf8");
  const parsed = Papa.parse<ColabCsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return parsed.data;
}

function loadPython(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FX, name), "utf8"));
}

interface PythonWeekly {
  overall: { target: number; actual: number; var: number; ratio: number };
  milestone: {
    to_complete: { wk_plan: number; wk_done: number; wk_items: string[]; wk_open_items: string[]; spill: number; spill_items: string[] };
    to_start:    { wk_plan: number; wk_started: number; wk_items: string[]; notstarted_items: string[]; spill: number; spill_items: string[] };
    in_progress: { plan: number; actual: number; plan_items: string[]; notmoving_items: string[] };
  };
  reasons_meta: {
    items: Array<{
      reason: string;
      acts: number;
      nvillas: number;
      villas: string[];
      avg_delay: number | null;
      max_delay: number | null;
    }>;
  };
}

describe("computeMilestoneBuckets — §2 buckets vs Python", () => {
  function runWeek(csvName: string, jsonName: string, wks: Date, wke: Date, label: string) {
    it(`matches ${label}`, () => {
      const rows = loadCsv(csvName);
      const py = loadPython(jsonName) as PythonWeekly;
      const stages = reconstructStages(rows, wke);
      const b = computeMilestoneBuckets(stages, wks, wke);
      // TO COMPLETE
      expect(b.toComplete.wkPlan).toBe(py.milestone.to_complete.wk_plan);
      expect(b.toComplete.wkDone).toBe(py.milestone.to_complete.wk_done);
      expect(b.toComplete.spill).toBe(py.milestone.to_complete.spill);
      expect(b.toComplete.spillItems).toEqual(py.milestone.to_complete.spill_items);
      // TO START
      expect(b.toStart.wkPlan).toBe(py.milestone.to_start.wk_plan);
      expect(b.toStart.wkStarted).toBe(py.milestone.to_start.wk_started);
      expect(b.toStart.spill).toBe(py.milestone.to_start.spill);
      expect(b.toStart.spillItems).toEqual(py.milestone.to_start.spill_items);
      expect(b.toStart.notStartedItems).toEqual(py.milestone.to_start.notstarted_items);
      // IN PROGRESS
      expect(b.inProgress.plan).toBe(py.milestone.in_progress.plan);
      expect(b.inProgress.actual).toBe(py.milestone.in_progress.actual);
      expect(b.inProgress.planItems).toEqual(py.milestone.in_progress.plan_items);
      expect(b.inProgress.notMovingItems).toEqual(py.milestone.in_progress.notmoving_items);
    });
  }
  runWeek(
    "wk23_input.csv", "wk23_python.json",
    new Date(Date.UTC(2026, 7, 17)), new Date(Date.UTC(2026, 7, 23)),
    "wk23 (17-23 Aug 2026)",
  );
  runWeek(
    "wk30_input.csv", "wk30_python.json",
    new Date(Date.UTC(2026, 7, 24)), new Date(Date.UTC(2026, 7, 30)),
    "wk30 (24-30 Aug 2026)",
  );
});

describe("computeDelayReasons — §5 reason clusters vs Python", () => {
  function runWeek(csvName: string, jsonName: string, wke: Date, label: string) {
    it(`matches ${label}`, () => {
      const rows = loadCsv(csvName);
      const py = loadPython(jsonName) as PythonWeekly;
      const mine = computeDelayReasons(rows, wke);
      // Compare bucket-by-bucket. Python's sort order (acts desc) must match.
      expect(mine.map((r) => r.reason)).toEqual(py.reasons_meta.items.map((r) => r.reason));
      for (let i = 0; i < py.reasons_meta.items.length; i++) {
        const p = py.reasons_meta.items[i];
        const m = mine[i];
        expect(m.acts).toBe(p.acts);
        expect(m.nvillas).toBe(p.nvillas);
        expect(m.villas).toEqual(p.villas);
        expect(m.avgDelay).toBe(p.avg_delay);
        expect(m.maxDelay).toBe(p.max_delay);
      }
    });
  }
  runWeek("wk23_input.csv", "wk23_python.json", new Date(Date.UTC(2026, 7, 23)), "wk23");
  runWeek("wk30_input.csv", "wk30_python.json", new Date(Date.UTC(2026, 7, 30)), "wk30");
});

describe("computeOverall — §1 Overall Project Progress vs Python", () => {
  it("matches wk23 (17-23 Aug 2026)", () => {
    const rows = loadCsv("wk23_input.csv");
    const py = loadPython("wk23_python.json") as PythonWeekly;
    const weekEnd = new Date(Date.UTC(2026, 7, 23)); // Aug 23
    const mine = computeOverall(rows, weekEnd);
    expect(mine.target).toBe(py.overall.target);
    expect(mine.actual).toBe(py.overall.actual);
    expect(mine.variancePp).toBe(py.overall.var);
    expect(mine.ratio).toBe(py.overall.ratio);
  });

  it("matches wk30 (24-30 Aug 2026)", () => {
    const rows = loadCsv("wk30_input.csv");
    const py = loadPython("wk30_python.json") as PythonWeekly;
    const weekEnd = new Date(Date.UTC(2026, 7, 30)); // Aug 30
    const mine = computeOverall(rows, weekEnd);
    expect(mine.target).toBe(py.overall.target);
    expect(mine.actual).toBe(py.overall.actual);
    expect(mine.variancePp).toBe(py.overall.var);
    expect(mine.ratio).toBe(py.overall.ratio);
  });
});
