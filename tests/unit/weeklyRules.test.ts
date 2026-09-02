import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { computeOverall, type ColabCsvRow } from "@/lib/rules/weeklyRules";

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
}

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
