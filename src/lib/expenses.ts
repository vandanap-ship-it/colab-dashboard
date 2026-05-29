/**
 * Project-expense rules + math (Phase 2).
 *
 * A general expense (petty cash / reimbursement / vendor purchase) captured the
 * same way. Money is only TRACKED — the app never moves funds. Pure helpers so
 * the totals and rules are unit-testable; the server recomputes, never trusting
 * client-sent totals.
 */

export const EXPENSE_CATEGORIES = [
  "Materials",
  "Transport",
  "Labour",
  "Food & Boarding",
  "Equipment",
  "Miscellaneous",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Coerce a category to one of the standard list, defaulting to Miscellaneous. */
export function normalizeCategory(c: unknown): ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(c as string)
    ? (c as ExpenseCategory)
    : "Miscellaneous";
}

/** Parse a strictly-positive amount, or null if absent/invalid. */
export function parseAmount(v: unknown): number | null {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !isFinite(n) || n <= 0) return null;
  return round2(n);
}

/** Per-status and per-category totals + grand and approved totals, for summaries. */
export function summariseExpenses(
  expenses: { status: string; category: string; amount: number }[],
): {
  byStatus: Record<string, { count: number; total: number }>;
  byCategory: Record<string, { count: number; total: number }>;
  grandTotal: number;
  approvedTotal: number;
} {
  const byStatus: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  let grandTotal = 0;
  let approvedTotal = 0;
  for (const e of expenses) {
    const amt = isFinite(e.amount) ? e.amount : 0;
    const bs = byStatus[e.status] ?? { count: 0, total: 0 };
    bs.count += 1;
    bs.total = round2(bs.total + amt);
    byStatus[e.status] = bs;
    const bc = byCategory[e.category] ?? { count: 0, total: 0 };
    bc.count += 1;
    bc.total = round2(bc.total + amt);
    byCategory[e.category] = bc;
    grandTotal = round2(grandTotal + amt);
    if (e.status === "APPROVED") approvedTotal = round2(approvedTotal + amt);
  }
  return { byStatus, byCategory, grandTotal, approvedTotal };
}

export type ExpenseCsvRow = {
  date: string;
  category: string;
  description: string;
  paidTo: string | null;
  amount: number;
  status: string;
};

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function expensesToCsv(rows: ExpenseCsvRow[]): string {
  const header = ["Date", "Category", "Description", "Paid To", "Amount", "Status"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.date, r.category, r.description, r.paidTo ?? "", r.amount, r.status].map(csvCell).join(","));
  }
  return lines.join("\n");
}

/**
 * Allowed expense status transitions and who may do them:
 *   SUBMITTED → APPROVED | REJECTED   (approver)
 *   REJECTED  → SUBMITTED             (logger reworks and resubmits)
 */
export function allowedExpenseTransition(from: string, to: string): "approve" | "resubmit" | null {
  if (from === "SUBMITTED" && (to === "APPROVED" || to === "REJECTED")) return "approve";
  if (from === "REJECTED" && to === "SUBMITTED") return "resubmit";
  return null;
}
