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

// Colab-parity: 5 permit templates from Shraddha's HSE Checklist zip
// (Sep 2026). HEIGHT was added alongside the existing four so the site
// team sees exactly Colab's set.
export const WORK_PERMIT_TYPES = [
  "HOT_WORK",
  "NIGHT_WORK",
  "DESHUTTERING",
  "GENERAL",
  "HEIGHT",
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
  HEIGHT: "Work At Height",
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
  HEIGHT: "Work above 2m — scaffolding, ladders, roof edges, façade",
};

// Colab-parity: SUSPENDED status added so an approver with the
// "Can Suspend" capability can temporarily halt an active permit
// without rejecting it outright. Approver capabilities live on the
// PermitApprover row (level + userId + canClose + canSuspend).
export const WORK_PERMIT_STATUSES = [
  "PENDING",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
  "CLOSED",
] as const;
export type WorkPermitStatus = (typeof WORK_PERMIT_STATUSES)[number];

export const WORK_PERMIT_STATUS_LABELS: Record<WorkPermitStatus, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

/**
 * Colab-parity permit checklists — the CHECKPOINTS section content each
 * template shows on step 3 of the wizard. Questions are sourced from
 * the "Work Permit and HSE Checklist" zip Shraddha delivered
 * (2026-09-30) — those forms are the original safety-officer paper
 * checklists Colab digitised. Do NOT invent or reword; every item must
 * trace back to the source form.
 *
 * Each item renders as: question text · Yes/No toggle · optional
 * remark · optional photo attach.
 */
export const WORK_PERMIT_CHECKPOINTS: Record<WorkPermitType, string[]> = {
  HOT_WORK: [
    "Has a Work method Risk",
    "Is the operator/welder/cutter competent?",
    "Are appropriate PPEs provided to every one involved in this work?",
    "Are All personal involved in this activity undergone Hot Work training?",
    "All power tools in good working order",
    "Ventilation sufficient?",
    "No overlapping tasks / work",
  ],
  NIGHT_WORK: [
    "Adequate lighting arranged for the entire work area?",
    "Emergency contact list posted and communicated?",
    "Rest breaks scheduled and workers rotated?",
    "Sound levels within permitted limits for the surrounding area?",
    "Supervisor available on site through the night?",
  ],
  DESHUTTERING: [
    "Proper working platform (min 1000mm) provided?",
    "Is Slab has attained the stipulated strength to de-shutter?",
    "Correct tools are used for de-shuttering?",
    "Barrication provided below the de-shuttering area?",
    "PPEs (helmet, harness, gloves) worn by every worker?",
  ],
  GENERAL: [
    "Work area barricaded and signage in place?",
    "Workers briefed on the Work method Statement?",
    "PPEs available and worn by all workers?",
    "Tools and equipment inspected before use?",
    "Emergency exits and first-aid kit accessible?",
  ],
  HEIGHT: [
    "All workers wearing full-body harness anchored to rigid support?",
    "Fall arrest / life line installed and inspected?",
    "Scaffolding erected and inspected by a competent person?",
    "Toe boards and mid-rails present on all open sides?",
    "Barricade below the work area to keep clear zone?",
    "Weather conditions (wind, rain) safe for height work?",
    "Workers medically fit for height work?",
  ],
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
): "approve" | "reject" | "close" | "suspend" | "resume" | null {
  if (from === to) return null;
  if (from === "PENDING" && to === "APPROVED") return "approve";
  if (from === "PENDING" && to === "REJECTED") return "reject";
  if (from === "APPROVED" && to === "REJECTED") return "reject";
  if (from === "APPROVED" && to === "CLOSED") return "close";
  // Colab-parity: an approver with the "Can Suspend" capability can halt
  // an active permit, and later resume it back to APPROVED (or close it).
  if (from === "APPROVED" && to === "SUSPENDED") return "suspend";
  if (from === "SUSPENDED" && to === "APPROVED") return "resume";
  if (from === "SUSPENDED" && to === "CLOSED") return "close";
  if (from === "SUSPENDED" && to === "REJECTED") return "reject";
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
