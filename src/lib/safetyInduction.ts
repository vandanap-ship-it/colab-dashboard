/**
 * Colab-parity human-readable id shown on Safety Induction cards.
 * Format: `EP-XXXXXXXX` where XXXXXXXX is 8 random uppercase chars from
 * a confusable-free alphabet (no I/O/0/1).
 *
 * Siddhi uses a random id rather than Colab's sequential counter so we
 * avoid cross-tenant leakage (sequence tells readers "there are N total
 * inductions in this tenant") and sidestep race conditions on parallel
 * creates. Matches the same approach as generateProgressDisplayId in
 * src/lib/progress.ts and the CHECKXXXXXX pattern used for inspections.
 *
 * Collision math: 32^8 = ~1.1 trillion. Even at 10k inductions per project
 * the chance of a collision is <5e-8; the DB unique index catches it
 * anyway and the caller retries.
 */
export function generateInductionDisplayId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "EP-";
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/**
 * Six months after the induction date. Vandana 2026-11-04 management
 * review: reduced the window from 12 months to 6 months so site teams
 * re-verify workers twice a year instead of once. Returns a Date so the
 * caller can store it directly as a Prisma DateTime.
 *
 * Takes a Date rather than ISO string so callers don't have to re-parse
 * what they just serialized. Pure function - no clock dependency - so the
 * nightly expiry cron can trust it even when the server timezone drifts.
 */
export const INDUCTION_VALIDITY_MONTHS = 6;

export function computeInductionExpiry(inductionDate: Date): Date {
  const d = new Date(inductionDate);
  d.setMonth(d.getMonth() + INDUCTION_VALIDITY_MONTHS);
  return d;
}

/**
 * Valid status values on the SafetyInduction row. Kept as a Set so the
 * API's PATCH schema can enum-validate without pulling Prisma types into
 * the Zod layer.
 */
export const INDUCTION_STATUSES = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const);

export type InductionStatus = typeof INDUCTION_STATUSES extends Set<infer T>
  ? T
  : never;
