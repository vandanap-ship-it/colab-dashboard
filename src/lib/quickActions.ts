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
  | "raise-rfi";

export function quickActionsFor(modulesField: string | null | undefined): QuickAddKey[] {
  const out: QuickAddKey[] = [];
  if (canAccessModule(modulesField, MODULES.PROGRESS)) {
    out.push("log-progress", "log-manpower");
  }
  // A WIR can be raised by anyone with QA/QC or Safety module access —
  // both teams file inspection requests against their respective
  // module. The row is tagged with primaryModuleFor() on create.
  if (
    canAccessModule(modulesField, MODULES.QAQC) ||
    canAccessModule(modulesField, MODULES.SAFETY)
  ) {
    out.push("raise-wir");
  }
  if (canAccessModule(modulesField, MODULES.HINDRANCE)) out.push("add-hindrance");
  if (canAccessModule(modulesField, MODULES.CONCERN)) out.push("add-concern");
  if (canAccessModule(modulesField, MODULES.RFI)) out.push("raise-rfi");
  return out;
}
