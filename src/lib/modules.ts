/**
 * Module-level access control.
 *
 * Internal White Lotus staff have full access (modules = null). External
 * contractors are scoped to one or more modules, e.g. a QA/QC inspection
 * agency only sees QAQC, and a safety contractor only sees SAFETY.
 *
 * A scoped user:
 *   - sees only the mobile tools belonging to their module(s)
 *   - cannot browse the schedule / activities
 *   - cannot log daily progress
 *   - sees only records (inspections, snags) tagged with their module
 *
 * The user's `modules` field is stored as a JSON string array, or null/empty
 * for full access.
 */

export const MODULES = {
  PROGRESS: "PROGRESS", // daily progress, site progress, DLR, schedule browsing
  QAQC: "QAQC", // quality inspections + quality snags
  SAFETY: "SAFETY", // safety inspections + safety issues
  HINDRANCE: "HINDRANCE", // hindrance reporting
  CONCERN: "CONCERN", // areas of concern
  RFI: "RFI", // requests for information (site → consultant/designer)
  PERMIT: "PERMIT", // permits register + renewal alerts
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

export const MODULE_LABELS: Record<string, string> = {
  PROGRESS: "Progress & Schedule",
  QAQC: "Quality (QA/QC)",
  SAFETY: "Safety",
  HINDRANCE: "Hindrances",
  CONCERN: "Areas of Concern",
  RFI: "RFI (Requests for Information)",
  PERMIT: "Permits",
};

export const ALL_MODULES: ModuleKey[] = Object.values(MODULES);

/**
 * Parse a user's stored modules field.
 * Returns null when the user has full access (internal staff), or a Set of
 * allowed module keys when the user is scoped (external contractor).
 */
export function parseUserModules(modulesField: string | null | undefined): Set<ModuleKey> | null {
  if (!modulesField) return null; // full access
  try {
    const arr = JSON.parse(modulesField);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const valid = arr.filter((m): m is ModuleKey => ALL_MODULES.includes(m as ModuleKey));
    return valid.length > 0 ? new Set(valid) : null;
  } catch {
    return null;
  }
}

/** True when the user can access the given module. Full-access users always can. */
export function canAccessModule(
  modulesField: string | null | undefined,
  module: ModuleKey,
): boolean {
  const mods = parseUserModules(modulesField);
  if (mods === null) return true; // full access
  return mods.has(module);
}

/** True when the user has full (unscoped) access. */
export function hasFullAccess(modulesField: string | null | undefined): boolean {
  return parseUserModules(modulesField) === null;
}

/** True when the user is scoped to specific modules (i.e. an external contractor). */
export function isScopedUser(modulesField: string | null | undefined): boolean {
  return parseUserModules(modulesField) !== null;
}

/**
 * Which modules grant access to each mobile tool. A tool is visible if the
 * user has full access, or any of the tool's modules is in the user's set.
 * Inspection + Snag belong to both QAQC and SAFETY (both raise them).
 */
export const TOOL_MODULES: Record<string, ModuleKey[]> = {
  "new-progress": [MODULES.PROGRESS],
  "site-progress": [MODULES.PROGRESS],
  dlr: [MODULES.PROGRESS],
  snag: [MODULES.QAQC, MODULES.SAFETY],
  inspection: [MODULES.QAQC, MODULES.SAFETY],
  hindrance: [MODULES.HINDRANCE],
  manpower: [MODULES.PROGRESS],
  concern: [MODULES.CONCERN],
  rfi: [MODULES.RFI],
  permit: [MODULES.PERMIT],
  // Expenses are internal-only. Gating on PROGRESS shows it to internal site
  // staff (full access) and hides it from scoped QAQC/Safety contractors.
  expense: [MODULES.PROGRESS],
};

/** True when the user can access a tool given the tool's owning modules. */
export function canAccessTool(
  modulesField: string | null | undefined,
  toolModules: ModuleKey[],
): boolean {
  const mods = parseUserModules(modulesField);
  if (mods === null) return true; // full access
  return toolModules.some((m) => mods.has(m));
}

/**
 * The module a scoped user creates records under (for tagging inspections /
 * snags). Returns the first scoped module, or null for full-access users
 * (whose records stay untagged / general).
 */
export function primaryModuleFor(modulesField: string | null | undefined): ModuleKey | null {
  const mods = parseUserModules(modulesField);
  if (mods === null) return null;
  // Prefer SAFETY then QAQC for the common contractor cases.
  if (mods.has(MODULES.SAFETY)) return MODULES.SAFETY;
  if (mods.has(MODULES.QAQC)) return MODULES.QAQC;
  return [...mods][0] ?? null;
}

/**
 * Normalise a modules array into the canonical JSON string for storage.
 * Returns null for full access (empty / nullish input).
 */
export function serializeModules(modules: string[] | null | undefined): string | null {
  if (!modules || modules.length === 0) return null;
  const valid = modules.filter((m): m is ModuleKey => ALL_MODULES.includes(m as ModuleKey));
  return valid.length > 0 ? JSON.stringify(valid) : null;
}
