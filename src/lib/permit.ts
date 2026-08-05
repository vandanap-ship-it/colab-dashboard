// ---------------------------------------------------------------------------
// Permit helpers — status derivation, validation, and label maps.
// Pure logic (no Prisma dep) so it's cheap to unit-test.
// ---------------------------------------------------------------------------

export const PERMIT_CATEGORIES = [
  "BUILDING",
  "ENVIRONMENTAL",
  "FIRE",
  "LABOUR",
  "WATER",
  "OTHER",
] as const;
export type PermitCategory = (typeof PERMIT_CATEGORIES)[number];

export const PERMIT_STATUSES = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "RENEWED"] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

export const PERMIT_CATEGORY_LABELS: Record<PermitCategory, string> = {
  BUILDING: "Building permit",
  ENVIRONMENTAL: "Environmental (Pollution Control)",
  FIRE: "Fire NOC",
  LABOUR: "Labour licence",
  WATER: "Water / borewell",
  OTHER: "Other",
};

export const PERMIT_STATUS_LABELS: Record<PermitStatus, string> = {
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  RENEWED: "Renewed",
};

const MS_PER_DAY = 86_400_000;

/**
 * Derive the *canonical* status of a permit from its dates. Ignores the
 * stored `status` — that only comes into play when the user overrides
 * (typically to mark RENEWED before the automatic expiry check would flip
 * things to EXPIRED).
 */
export function canonicalPermitStatus(opts: {
  expiryDate: Date | null;
  renewalReminderDays: number;
  today?: Date;
}): PermitStatus {
  const today = opts.today ?? new Date();
  if (!opts.expiryDate) return "ACTIVE";  // permanent permit
  const daysUntilExpiry = Math.round((opts.expiryDate.getTime() - today.getTime()) / MS_PER_DAY);
  if (daysUntilExpiry < 0) return "EXPIRED";
  if (daysUntilExpiry <= opts.renewalReminderDays) return "EXPIRING_SOON";
  return "ACTIVE";
}

/**
 * Merge stored status with the canonical one:
 *   - RENEWED is respected always (user knows the new permit is in hand)
 *   - Otherwise return the canonical (auto-derived) status.
 */
export function effectivePermitStatus(opts: {
  storedStatus: PermitStatus;
  expiryDate: Date | null;
  renewalReminderDays: number;
  today?: Date;
}): PermitStatus {
  if (opts.storedStatus === "RENEWED") return "RENEWED";
  return canonicalPermitStatus({
    expiryDate: opts.expiryDate,
    renewalReminderDays: opts.renewalReminderDays,
    today: opts.today,
  });
}

export function daysUntilExpiry(expiry: Date | null, today = new Date()): number | null {
  if (!expiry) return null;
  return Math.round((expiry.getTime() - today.getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export interface CreatePermitInput {
  name: string;
  number?: string | null;
  issuingAuthority: string;
  category: PermitCategory;
  issuedDate: string;              // ISO date
  expiryDate?: string | null;      // ISO date or null (permanent)
  notes?: string | null;
  documentUrl?: string | null;
  responsibleUserId?: string | null;
  renewalReminderDays?: number;
}

export interface ValidationError {
  field: keyof CreatePermitInput | "status";
  message: string;
}

export function validateCreatePermit(input: Partial<CreatePermitInput>): ValidationError[] {
  const errs: ValidationError[] = [];
  const name = (input.name ?? "").trim();
  const authority = (input.issuingAuthority ?? "").trim();
  if (!name) errs.push({ field: "name", message: "Permit name is required." });
  if (name.length > 200) errs.push({ field: "name", message: "Permit name must be under 200 characters." });
  if (!authority) errs.push({ field: "issuingAuthority", message: "Issuing authority is required." });
  if (!input.category || !PERMIT_CATEGORIES.includes(input.category)) {
    errs.push({ field: "category", message: "Category is required." });
  }
  if (!input.issuedDate) {
    errs.push({ field: "issuedDate", message: "Issue date is required." });
  } else {
    const d = new Date(input.issuedDate);
    if (isNaN(d.getTime())) errs.push({ field: "issuedDate", message: "Issue date is not a valid date." });
  }
  if (input.expiryDate) {
    const d = new Date(input.expiryDate);
    if (isNaN(d.getTime())) errs.push({ field: "expiryDate", message: "Expiry date is not a valid date." });
    // Expiry must be on or after issue date
    if (input.issuedDate) {
      const issued = new Date(input.issuedDate);
      if (!isNaN(d.getTime()) && !isNaN(issued.getTime()) && d < issued) {
        errs.push({ field: "expiryDate", message: "Expiry cannot be before issue date." });
      }
    }
  }
  if (input.renewalReminderDays != null) {
    if (!Number.isInteger(input.renewalReminderDays) || input.renewalReminderDays < 1 || input.renewalReminderDays > 365) {
      errs.push({ field: "renewalReminderDays", message: "Reminder must be 1–365 days." });
    }
  }
  return errs;
}
