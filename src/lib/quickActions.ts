/**
 * Pure gating for the mobile "+" FAB.
 *
 * Same shape as TOOL_MODULES gates tiles on the home: given a user's
 * modules field, return the exact set of quick-add actions their
 * account permits. Kept as a plain lib so:
 *   - QuickAddFab imports the type from here (no client → client import).
 *   - The mobile layout composes the action list without inline module
 *     branching.
 *   - Golden tests can exercise every persona without pulling React.
 *
 * If a new action lands, add it to the QuickAddKey union AND to
 * quickActionsFor() below. The role-visibility test then locks which
 * personas can see it.
 */
import { canAccessModule, MODULES } from "@/lib/modules";

export type QuickAddKey =
  | "log-progress"
  | "log-manpower"
  | "add-hindrance"
  | "add-concern"
  | "raise-wir"
  | "raise-snag"
  | "raise-hse-checklist"
  | "raise-permit";

export function quickActionsFor(modulesField: string | null | undefined): QuickAddKey[] {
  const out: QuickAddKey[] = [];
  if (canAccessModule(modulesField, MODULES.PROGRESS)) {
    out.push("log-progress", "log-manpower");
  }
  // WIRs = QAQC's whole raise-flow (quality inspections).
  if (canAccessModule(modulesField, MODULES.QAQC)) {
    out.push("raise-wir");
  }
  if (canAccessModule(modulesField, MODULES.SAFETY)) {
    // Safety raises BOTH permits and HSE Inspection Checklists —
    // Colab 2026-10-01 parity, Girish's native app home has three
    // tiles: Inspection Checklist / Permits / Safety Induction.
    // Both the FAB entries sit here so the + button carries the
    // same two actions.
    out.push("raise-hse-checklist");
    out.push("raise-permit");
  }
  // Observation (Colab: snag) — either QA/QC or Safety scope can raise
  // one. Shraddha 2026-09-30: Thangamani needed a one-tap way to file
  // an issue from anywhere in the mobile app, not just from the home
  // tile grid, so the FAB now carries it too.
  if (
    canAccessModule(modulesField, MODULES.QAQC) ||
    canAccessModule(modulesField, MODULES.SAFETY)
  ) {
    out.push("raise-snag");
  }
  if (canAccessModule(modulesField, MODULES.HINDRANCE)) out.push("add-hindrance");
  if (canAccessModule(modulesField, MODULES.CONCERN)) out.push("add-concern");
  return out;
}
