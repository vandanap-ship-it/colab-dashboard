import Papa from "papaparse";

export type ParsedRow = {
  rowIndex: number;
  taskCode: string;
  name: string;
  level: number;
  baselineStart: Date | null;
  baselineFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  projectedFinish: Date | null;
  percentComplete: number;
  predecessorsRaw: string | null;
  category: string | null;
  totalQuantity: number | null;
  unit: string | null;
  contractorName: string | null;
};

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; warnings: string[] }
  | { ok: false; error: string };

const COL_ALIASES: Record<keyof ParsedRow, string[]> = {
  rowIndex: [],
  taskCode: ["id", "task id", "wbs", "wbs code", "outline number"],
  name: ["task name", "name", "task"],
  level: ["outline level", "level", "wbs level"],
  baselineStart: ["baseline start", "planned start", "start"],
  baselineFinish: ["baseline finish", "planned finish", "finish (planned)", "planned end"],
  actualStart: ["actual start"],
  actualFinish: ["actual finish"],
  projectedFinish: ["finish", "projected finish", "projected end"],
  percentComplete: ["% complete", "% comp.", "percent complete", "progress"],
  predecessorsRaw: ["predecessors", "preds"],
  category: ["category", "tag"],
  totalQuantity: ["total quantity", "quantity"],
  unit: ["unit", "uom"],
  contractorName: ["contractor"],
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NA") return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  // "16 Sep '25" or "16 Sep 2025"
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+'?(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = months[m[2].toLowerCase()];
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (mon !== undefined) return new Date(Date.UTC(year, mon, day));
  }
  // ISO or other parseable
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parsePercent(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim().replace("%", "");
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim());
  return isFinite(n) ? n : null;
}

function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (candidates.includes(normalize(key))) return row[key];
  }
  return undefined;
}

export function parseWBSCsv(csv: string): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { ok: false, error: parsed.errors[0].message };
  }

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const name = String(pick(r, COL_ALIASES.name) ?? "").trim();
    if (!name) continue;

    const levelRaw = pick(r, COL_ALIASES.level);
    const level = Number(levelRaw);
    if (!isFinite(level) || level < 1) {
      warnings.push(`Row ${i + 2}: missing/invalid Outline Level — skipped`);
      continue;
    }

    const taskCodeRaw = pick(r, COL_ALIASES.taskCode);
    const taskCode = String(taskCodeRaw ?? `R${i + 1}`).trim() || `R${i + 1}`;

    rows.push({
      rowIndex: i,
      taskCode,
      name,
      level: Math.floor(level),
      baselineStart: parseDate(pick(r, COL_ALIASES.baselineStart)),
      baselineFinish: parseDate(pick(r, COL_ALIASES.baselineFinish)),
      actualStart: parseDate(pick(r, COL_ALIASES.actualStart)),
      actualFinish: parseDate(pick(r, COL_ALIASES.actualFinish)),
      projectedFinish: parseDate(pick(r, COL_ALIASES.projectedFinish)),
      percentComplete: parsePercent(pick(r, COL_ALIASES.percentComplete)),
      predecessorsRaw: ((): string | null => {
        const v = pick(r, COL_ALIASES.predecessorsRaw);
        const s = v === null || v === undefined ? "" : String(v).trim();
        return s ? s : null;
      })(),
      category: ((): string | null => {
        const v = pick(r, COL_ALIASES.category);
        const s = v === null || v === undefined ? "" : String(v).trim();
        return s ? s : null;
      })(),
      totalQuantity: parseNumber(pick(r, COL_ALIASES.totalQuantity)),
      unit: ((): string | null => {
        const v = pick(r, COL_ALIASES.unit);
        const s = v === null || v === undefined ? "" : String(v).trim();
        return s ? s : null;
      })(),
      contractorName: ((): string | null => {
        const v = pick(r, COL_ALIASES.contractorName);
        const s = v === null || v === undefined ? "" : String(v).trim();
        return s ? s : null;
      })(),
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "No usable rows found. Need columns: Task Name + Outline Level (at minimum)." };
  }

  return { ok: true, rows, warnings };
}

export type TreeBuildResult = {
  nodes: Array<ParsedRow & { parentTaskCode: string | null; orderIndex: number }>;
};

export function buildTree(rows: ParsedRow[]): TreeBuildResult {
  // Stack: index = level, value = taskCode of last seen node at that level
  const stack: string[] = [];
  const ordersByLevel: Record<number, number> = {};
  const out: TreeBuildResult["nodes"] = [];

  for (const r of rows) {
    // Truncate stack to level - 1
    stack.length = r.level - 1;
    const parentTaskCode = stack.length > 0 ? stack[stack.length - 1] : null;
    ordersByLevel[r.level] = (ordersByLevel[r.level] ?? -1) + 1;
    const orderIndex = ordersByLevel[r.level];
    out.push({ ...r, parentTaskCode, orderIndex });
    stack[r.level - 1] = r.taskCode;
  }

  return { nodes: out };
}
