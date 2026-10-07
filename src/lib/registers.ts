/**
 * Registers — shared, pure helpers used by the API, the mobile + desktop
 * screens, the due-date cron and the print view. No Prisma / server
 * imports so client components can reuse the same validation the server
 * enforces.
 *
 * Dates inside RegisterRow.values are calendar days stored as
 * "YYYY-MM-DD" strings. RegisterRow.nextDueDate mirrors the due column
 * as UTC midnight for that day — the same convention every other
 * calendar-day column in Siddhi uses (see src/lib/istDay.ts).
 */

export type RegisterColumnKind = "text" | "date" | "select" | "number";

export type RegisterColumn = {
  key: string;
  label: string;
  kind: RegisterColumnKind;
  required?: boolean;
  placeholder?: string;
  /** select only */
  options?: string[];
  /** select only — accept a free-text value outside `options` */
  allowOther?: boolean;
};

export type RegisterTypeDefinition = {
  code: string;
  name: string;
  shortName: string;
  module: string;
  orderIndex: number;
  identifierKey: string;
  dueDateKey?: string | null;
  lastInspectedKey?: string | null;
  defaultIntervalDays?: number | null;
  signOffIntervalDays?: number | null;
  inspectionTemplateCode?: string | null;
  preparedByLabel?: string | null;
  approvedByLabel?: string | null;
  columns: RegisterColumn[];
};

export type RegisterValues = Record<string, string>;

/** Days before the due date that a row turns amber + the maker is pinged. */
export const DUE_SOON_DAYS = 7;

export const SUBMISSION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce the RegisterType.columns JSON into typed columns, dropping any
 * entry that isn't shaped right. The data file is ours, but the column
 * comes back from Postgres as `unknown`.
 */
export function parseColumns(raw: unknown): RegisterColumn[] {
  if (!Array.isArray(raw)) return [];
  const out: RegisterColumn[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") continue;
    const kind = o.kind;
    if (kind !== "text" && kind !== "date" && kind !== "select" && kind !== "number") continue;
    out.push({
      key: o.key,
      label: o.label,
      kind,
      required: o.required === true,
      placeholder: typeof o.placeholder === "string" ? o.placeholder : undefined,
      options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : undefined,
      allowOther: o.allowOther === true,
    });
  }
  return out;
}

/** Coerce RegisterRow.values JSON into a string map. */
export function parseValues(raw: unknown): RegisterValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RegisterValues = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

/** True when `s` is a real calendar day in YYYY-MM-DD form. */
export function isIsoDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "YYYY-MM-DD" → UTC-midnight Date (the calendar-day convention). */
export function isoDayToDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(isoDay: string, days: number): string {
  return new Date(isoDayToDate(isoDay).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `fromDay` to `toDay` (both YYYY-MM-DD). Negative when toDay is earlier. */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((isoDayToDate(toDay).getTime() - isoDayToDate(fromDay).getTime()) / DAY_MS);
}

/** Upper-cased, whitespace-collapsed identifier used for uniqueness checks. */
export function normaliseIdentifier(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export type ValidationResult =
  | { ok: true; values: RegisterValues }
  | { ok: false; errors: Record<string, string> };

/**
 * Validate + normalise a row's values against the column schema. Unknown
 * keys are dropped; strings are trimmed; empty optional values are
 * omitted. The due date can't be earlier than the last-inspected date
 * when the type defines both.
 */
export function validateRowValues(
  columns: RegisterColumn[],
  input: Record<string, unknown>,
  keys: { dueDateKey?: string | null; lastInspectedKey?: string | null } = {},
): ValidationResult {
  const errors: Record<string, string> = {};
  const values: RegisterValues = {};

  for (const col of columns) {
    const rawVal = input[col.key];
    const str =
      typeof rawVal === "string" ? rawVal.trim() : typeof rawVal === "number" ? String(rawVal) : "";
    if (!str) {
      if (col.required) errors[col.key] = `${col.label} is required`;
      continue;
    }
    if (str.length > 200) {
      errors[col.key] = `${col.label} is too long (200 characters max)`;
      continue;
    }
    switch (col.kind) {
      case "date":
        if (!isIsoDay(str)) {
          errors[col.key] = `${col.label} must be a valid date`;
          continue;
        }
        break;
      case "number":
        if (!Number.isFinite(Number(str))) {
          errors[col.key] = `${col.label} must be a number`;
          continue;
        }
        break;
      case "select":
        if (!col.allowOther && !(col.options ?? []).includes(str)) {
          errors[col.key] = `Pick a ${col.label} from the list`;
          continue;
        }
        break;
      case "text":
        break;
    }
    values[col.key] = str;
  }

  const due = keys.dueDateKey ? values[keys.dueDateKey] : undefined;
  const last = keys.lastInspectedKey ? values[keys.lastInspectedKey] : undefined;
  if (due && last && due < last && keys.dueDateKey) {
    errors[keys.dueDateKey] = "Due date can't be before the last inspection";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values };
}

export type DueState = "overdue" | "due_soon" | "ok" | "none";

/**
 * Where a row sits against its due date, relative to the IST calendar
 * day `todayIso`. Due today counts as due soon (still inspectable today);
 * overdue starts the day after.
 */
export function dueState(nextDueIso: string | null | undefined, todayIso: string): DueState {
  if (!nextDueIso || !isIsoDay(nextDueIso)) return "none";
  const days = daysBetween(todayIso, nextDueIso);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

/** "Overdue by 3 days" / "Due today" / "Due in 5 days" / "Due 12 Jan 2027". */
export function dueLabel(nextDueIso: string | null | undefined, todayIso: string): string {
  if (!nextDueIso || !isIsoDay(nextDueIso)) return "No due date";
  const days = daysBetween(todayIso, nextDueIso);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  if (days <= DUE_SOON_DAYS) return `Due in ${days} day${days === 1 ? "" : "s"}`;
  return `Due ${formatIsoDay(nextDueIso)}`;
}

/** "2026-10-07" → "07 Oct 2026". Pure string math — no timezone involved. */
export function formatIsoDay(isoDay: string | null | undefined): string {
  if (!isoDay || !isIsoDay(isoDay)) return "—";
  const [y, m, d] = isoDay.split("-");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Human id for a sign-off: INV-XXXXXXXX. Random from a confusable-free
 * alphabet — same scheme as EP- (inductions) and progress display ids.
 */
export function generateSubmissionDisplayId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "INV-";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Frozen sign-off content. Shape of RegisterSubmission.snapshot. */
export type RegisterSnapshot = {
  version: 1;
  typeCode: string;
  typeName: string;
  projectName: string;
  columns: RegisterColumn[];
  identifierKey: string;
  preparedByLabel: string | null;
  approvedByLabel: string | null;
  rows: Array<{
    id: string;
    identifier: string;
    values: RegisterValues;
    villaLabel: string | null;
  }>;
};

export function parseSnapshot(raw: unknown): RegisterSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.rows)) return null;
  return {
    version: 1,
    typeCode: String(o.typeCode ?? ""),
    typeName: String(o.typeName ?? ""),
    projectName: String(o.projectName ?? ""),
    columns: parseColumns(o.columns),
    identifierKey: String(o.identifierKey ?? ""),
    preparedByLabel: typeof o.preparedByLabel === "string" ? o.preparedByLabel : null,
    approvedByLabel: typeof o.approvedByLabel === "string" ? o.approvedByLabel : null,
    rows: (o.rows as unknown[]).map((r) => {
      const row = (r ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        identifier: String(row.identifier ?? ""),
        values: parseValues(row.values),
        villaLabel: typeof row.villaLabel === "string" ? row.villaLabel : null,
      };
    }),
  };
}

/**
 * Natural sort for identifiers so FE-2 sorts before FE-10. Used for the
 * live list and the frozen snapshot so print order matches screen order.
 */
export function compareIdentifiers(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/**
 * True when the monthly sign-off is due: there's at least one live row
 * and the latest non-rejected submission is older than the interval (or
 * there's never been one).
 */
export function isSignOffDue(
  latestSubmissionAt: Date | null,
  intervalDays: number | null | undefined,
  now: Date,
  liveRowCount: number,
): boolean {
  if (!intervalDays || liveRowCount === 0) return false;
  if (!latestSubmissionAt) return true;
  return now.getTime() - latestSubmissionAt.getTime() >= intervalDays * DAY_MS;
}
