export const ROLES = {
  SITE_ENGINEER: "SITE_ENGINEER",
  SITE_MANAGER: "SITE_MANAGER",
  PLANNER: "PLANNER",
  PRODUCT_TEAM: "PRODUCT_TEAM",
  ADMIN: "ADMIN",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<string, string> = {
  SITE_ENGINEER: "Site Engineer",
  SITE_MANAGER: "Site Manager",
  PLANNER: "Planner",
  PRODUCT_TEAM: "Product Team",
  ADMIN: "Admin",
};

const MOBILE_ONLY = new Set<string>([ROLES.SITE_ENGINEER]);
const DESKTOP_ROLES = new Set<string>([
  ROLES.PLANNER,
  ROLES.PRODUCT_TEAM,
  ROLES.SITE_MANAGER,
  ROLES.ADMIN,
]);

export function defaultLandingFor(role: string): string {
  if (MOBILE_ONLY.has(role)) return "/mobile";
  if (role === ROLES.SITE_MANAGER) return "/mobile";
  if (DESKTOP_ROLES.has(role)) return "/";
  return "/login";
}

export function canSeeDesktop(role: string): boolean {
  return DESKTOP_ROLES.has(role);
}

export function canSeeMobile(role: string): boolean {
  return role === ROLES.SITE_ENGINEER || role === ROLES.SITE_MANAGER || role === ROLES.ADMIN;
}

export function canCreateProject(role: string): boolean {
  return role === ROLES.ADMIN || role === ROLES.PLANNER;
}

export function isAdmin(role: string): boolean {
  return role === ROLES.ADMIN;
}

/**
 * Roles that can resolve / pass / reject items raised by others —
 * Planners, Product Team, and Admins. Used by API route guards to enforce
 * the same permission boundary the UI already enforces.
 */
export function canReview(role: string): boolean {
  return role === ROLES.PLANNER || role === ROLES.PRODUCT_TEAM || role === ROLES.ADMIN;
}

/**
 * Sub-contractor billing is a two-step flow:
 *   - Planner (or Admin) prepares, edits, and submits a bill.
 *   - Manager (or Admin) approves, rejects, or marks it paid.
 * Scoped external contractors have neither permission.
 */
export function canPrepareBill(role: string): boolean {
  return role === ROLES.PLANNER || role === ROLES.ADMIN;
}

export function canApproveBill(role: string): boolean {
  return role === ROLES.SITE_MANAGER || role === ROLES.ADMIN;
}

/** Anyone in the billing flow (preparer or approver) may view bills. */
export function canAccessBilling(role: string): boolean {
  return canPrepareBill(role) || canApproveBill(role);
}
