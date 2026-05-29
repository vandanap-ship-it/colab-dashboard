/**
 * Sub-contractor billing math + rules (Phase 1).
 *
 * Money is only TRACKED here — nothing in this app moves funds. These helpers
 * are pure so the amount/total arithmetic can be unit-tested in isolation; the
 * server always recomputes line amounts and totals rather than trusting client
 * input.
 */

export const BILL_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_LINE_TYPES = ["ITEM_RATE", "LABOUR", "LUMP_SUM"] as const;
export type BillLineType = (typeof BILL_LINE_TYPES)[number];

export type BillLineInput = {
  type?: string;
  description?: string;
  wbsNodeId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  rate?: number | null;
  amount?: number | null;
};

export type NormalizedBillLine = {
  type: BillLineType;
  description: string;
  wbsNodeId: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  orderIndex: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse to a finite, non-negative number, or null if absent/invalid. */
function nonNegOrNull(v: unknown): number | null {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Normalize a client line item into a stored line. The amount is always
 * computed server-side: quantity × rate for ITEM_RATE/LABOUR, or the given
 * amount for LUMP_SUM. Never trust a client-sent amount for rated lines.
 */
export function normalizeLine(input: BillLineInput, orderIndex: number): NormalizedBillLine {
  const type: BillLineType = (BILL_LINE_TYPES as readonly string[]).includes(input.type ?? "")
    ? (input.type as BillLineType)
    : "LUMP_SUM";
  const quantity = nonNegOrNull(input.quantity);
  const rate = nonNegOrNull(input.rate);
  const lump = nonNegOrNull(input.amount);
  const amount =
    type === "LUMP_SUM" ? (lump ?? 0) : round2((quantity ?? 0) * (rate ?? 0));
  return {
    type,
    description: (input.description ?? "").trim(),
    wbsNodeId: input.wbsNodeId || null,
    quantity: type === "LUMP_SUM" ? null : quantity,
    unit: (input.unit ?? "").trim() || null,
    rate: type === "LUMP_SUM" ? null : rate,
    amount,
    orderIndex,
  };
}

/** Drop blank lines (no description and zero amount) so empty rows don't persist. */
export function cleanLines(inputs: BillLineInput[] | undefined): NormalizedBillLine[] {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .map((l, i) => normalizeLine(l, i))
    .filter((l) => l.description.length > 0 || l.amount > 0)
    .map((l, i) => ({ ...l, orderIndex: i }));
}

/** Subtotal (sum of line amounts), tax (optional %), and total. All rounded to 2dp. */
export function computeBillTotals(
  amounts: number[],
  taxPercent: number | null | undefined,
): { subtotal: number; tax: number; total: number } {
  const subtotal = round2(amounts.reduce((s, a) => s + (isFinite(a) ? a : 0), 0));
  const tax = taxPercent && taxPercent > 0 ? round2(subtotal * (taxPercent / 100)) : 0;
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/** Attach the derived subtotal/tax/total to a bill so the client never recomputes money. */
export function withTotals<T extends { taxPercent: number | null; lineItems: { amount: number }[] }>(
  bill: T,
) {
  const totals = computeBillTotals(bill.lineItems.map((l) => l.amount), bill.taxPercent);
  return { ...bill, ...totals };
}

/** Parse an ISO date string to a Date, or null if absent/invalid. */
export function parseBillDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse a non-negative tax percentage, or null if absent/invalid. */
export function parseTaxPercent(v: unknown): number | null {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Whether a status change is allowed, and who may do it. The flow is:
 *   DRAFT → SUBMITTED            (preparer: Planner/Admin)
 *   SUBMITTED → APPROVED|REJECTED (approver: Manager/Admin)
 *   SUBMITTED → DRAFT            (preparer pulls it back to edit)
 *   REJECTED → DRAFT             (preparer reworks)
 *   APPROVED → PAID              (approver marks paid)
 * Anything else is rejected.
 */
export function allowedBillTransition(from: string, to: string): "prepare" | "approve" | null {
  const prepare = new Set(["DRAFT>SUBMITTED", "SUBMITTED>DRAFT", "REJECTED>DRAFT"]);
  const approve = new Set(["SUBMITTED>APPROVED", "SUBMITTED>REJECTED", "APPROVED>PAID"]);
  const key = `${from}>${to}`;
  if (prepare.has(key)) return "prepare";
  if (approve.has(key)) return "approve";
  return null;
}
