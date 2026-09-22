/**
 * Pure helpers for the three-way inspection item state (Yes / No / NA).
 *
 * The state is stored as two flags on InspectionItem:
 *   passed         : boolean | null
 *   notApplicable  : boolean
 *
 * so the four reader-facing states resolve as:
 *   NA        →  notApplicable = true
 *   Yes       →  notApplicable = false, passed = true
 *   No        →  notApplicable = false, passed = false
 *   untouched →  notApplicable = false, passed = null
 *
 * These helpers are the single source of truth — everywhere in the app
 * that decides "is this row answered yet?" or "did the reviewer say Yes?"
 * calls into here so the taxonomy can't drift between the form, the API,
 * and any future reporting.
 */

export type InspectionItemInput = {
  passed: boolean | null | undefined;
  notApplicable: boolean | null | undefined;
};

export type InspectionItemState = "yes" | "no" | "na" | "untouched";

export function itemState(item: InspectionItemInput): InspectionItemState {
  if (item.notApplicable === true) return "na";
  if (item.passed === true) return "yes";
  if (item.passed === false) return "no";
  return "untouched";
}

export function isAnswered(item: InspectionItemInput): boolean {
  return itemState(item) !== "untouched";
}

/**
 * The number of items with a real Yes / No / NA answer — used everywhere
 * the app reports "N/M answered". NA counts as answered (that's the whole
 * point of the third choice).
 */
export function countAnswered(items: readonly InspectionItemInput[]): number {
  return items.filter(isAnswered).length;
}

/**
 * Pass-rate math for scorecards. NA rows drop out of the denominator — a
 * row that doesn't apply to this villa can't fail or pass, so it never
 * shifts the pass rate. Returns null when nothing applicable, so callers
 * render "—" instead of a fake 0%.
 */
export function passRate(items: readonly InspectionItemInput[]): number | null {
  let applicable = 0;
  let passed = 0;
  for (const i of items) {
    const s = itemState(i);
    if (s === "na" || s === "untouched") continue;
    applicable += 1;
    if (s === "yes") passed += 1;
  }
  if (applicable === 0) return null;
  return passed / applicable;
}
