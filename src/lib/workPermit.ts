/**
 * WorkPermit — daily site permits (Hot Work, Night Work, De-shuttering,
 * General Work). Not to be confused with `Permit` in the same schema, which
 * models annual/multi-year regulatory approvals.
 *
 * State machine:
 *   PENDING → APPROVED → CLOSED    (happy path)
 *   PENDING → REJECTED
 *   APPROVED → REJECTED             (rare — approver realizes setup is unsafe)
 *
 * First-approver-wins on `approverIds` (JSON string array of User.id) — any
 * one of the listed approvers can flip PENDING → APPROVED. Matches the
 * Colab export where multiple names appear but a single approver clicks OK.
 */

export const WORK_PERMIT_TYPES = [
  "HOT_WORK",
  "NIGHT_WORK",
  "DESHUTTERING",
  "GENERAL",
] as const;
export type WorkPermitType = (typeof WORK_PERMIT_TYPES)[number];

/**
 * Human labels for the picker + list. Update this map (and just this map) to
 * rename a type without a schema migration; the stored value stays the same.
 */
export const WORK_PERMIT_TYPE_LABELS: Record<WorkPermitType, string> = {
  HOT_WORK: "Hot Work",
  NIGHT_WORK: "Night Work / Holiday",
  DESHUTTERING: "De-shuttering",
  GENERAL: "General Work",
};

/**
 * Short descriptions shown under the type in the picker to help the requester
 * pick the right one. Kept intentionally short.
 */
export const WORK_PERMIT_TYPE_HINTS: Record<WorkPermitType, string> = {
  HOT_WORK: "Welding, cutting, grinding — any flame or spark work",
  NIGHT_WORK: "Work outside 06:00–18:00 or on a declared holiday",
  DESHUTTERING: "Removing formwork after curing",
  GENERAL: "Any daily work not covered by the specific types above",
};

export const WORK_PERMIT_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CLOSED"] as const;
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number];

export const WORK_PERMIT_STATUS_LABELS: Record<WorkPermitStatus, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

/**
 * Legal state transitions. Returns null if the target state cannot be
 * reached from the current one. Pure — safe to call anywhere.
 *
 * Currently the only "unusual" allowed transition is APPROVED → REJECTED,
 * which lets an approver pull the plug on a permit they just approved if
 * they realize the setup is unsafe (as long as the permit hasn't been
 * closed). CLOSED is terminal.
 */
export function allowedWorkPermitTransition(
  from: WorkPermitStatus,
  to: WorkPermitStatus,
): "approve" | "reject" | "close" | null {
  if (from === to) return null;
  if (from === "PENDING" && to === "APPROVED") return "approve";
  if (from === "PENDING" && to === "REJECTED") return "reject";
  if (from === "APPROVED" && to === "REJECTED") return "reject";
  if (from === "APPROVED" && to === "CLOSED") return "close";
  return null;
}

/**
 * Parse the stored `approverIds` JSON string into a User.id array. Returns
 * [] on malformed / empty input — never throws. Callers should validate the
 * result is non-empty when creating a permit.
 */
export function parseApproverIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * True if `userId` is in the approver list — used at the API boundary to
 * gate the approve/reject actions. Full-access admins are handled separately
 * (they can approve anything).
 */
export function isApprover(approverIds: string | null | undefined, userId: string): boolean {
  return parseApproverIds(approverIds).includes(userId);
}

/**
 * Serialize a User.id array into the stored JSON string form. Empty arrays
 * are represented as "[]" not null — the DB column is NOT NULL.
 */
export function serializeApproverIds(ids: string[]): string {
  return JSON.stringify(ids);
}

/**
 * "HH:MM" 24-hour validator. The DB stores start/end times as strings so
 * the workDate can be a plain date without timezone drift. This matches the
 * shape of the Colab export ("0 days 15:32:00" is 15:32 IST).
 */
export function isValidHhMm(v: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
}
