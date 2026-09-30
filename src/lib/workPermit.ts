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
    "Has a Work method Risk Assessment been carried out specifically identifying the risks associated with Hot work?",
    "Are appropriate PPEs provided to every one involved in this work?",
    "Have the Risk Assessment Control Measures/Actions been implemented?",
    "Area clear of combustible and flammable materials?",
    "Is Toolbox Talk conducted before start of activity?",
    "Fire extinguisher present?",
    "Cylinders fitted with flash back arrestors & kept in trolley. Use of approved lighter",
    "Fire watch provided?",
    "All power tools in good working order",
    "Shields / guards in place?",
    "Ventilation sufficient?",
    "No overlapping tasks / work",
    "Is the operator/welder/cutter competent?",
    "Are All personal involved in this activity undergone Hot Work training?",
    "Proper working platform (min 1000mm) with safe means of access while work at height & bottom area barricaded with caution",
  ],
  NIGHT_WORK: [
    "Has a Work method Risk Assessment been carried out specifically identifying the risks associated with work activity?",
    "Are appropriate PPEs provided to every one involved at Night / Holiday work?",
    "Have the Risk Assessment Control Measures/Actions been implemented?",
    "Are every one know the vehicle and equipment paths?",
    "Weather Night / Holiday work emergency mock drill conducted?",
    "Concerned activity in charge conducted Toolbox talk before start of activity?",
    "Proper illumination provided at work location / access?",
    "Are proper access and egress provided?",
    "Are activity based Permit-to-work (PTW) obtained?",
    "Know the safe routes to and from work area?",
    "Are every one wearing high visibility Jacket?",
    "Have considered to avoid high noise activity?",
    "Is Alcohol and drug inspection carried out for workmen?",
    "Clear signage, Reflective tape provided?",
  ],
  DESHUTTERING: [
    "Has a Work method statement and Risk Assessment been carried out specifically identifying the risks associated with De-shuttering?",
    "Are appropriate PPEs provided to every one involved in work at height activity?",
    "Have the Risk Assessment Control Measures/Actions been implemented?",
    "Workers are trained/skilled workers are deployed?",
    "Is Toolbox Talk conducted before start of activity?",
    "Is the de-shuttering area maintained with good illumination (Minimum 200 lux)?",
    "Ensure that entire activities are carried out under proper supervision?",
    "All Electrical wires, DB boards are removed from deshuttering area?",
    "All openings are covered and barricaded?",
    "Proper working platform (min 1000mm) provided?",
    "Is activity monitored by a competent person?",
    "Is Slab has attained the stipulated strength to de-shutter?",
    "Is the area of deshuttering barricaded to avoided unauthorized entry?",
    "Correct tools are used for de-shuttering?",
    "Warning signage is displayed?",
    "No overlapping tasks / work?",
    "Are All personal involved in this activity undergone De-shuttering training?",
  ],
  GENERAL: [
    "Work area barricaded and warning signs displayed",
    "Hot work area cleared of flammables, fire extinguisher available",
    "All workers have valid ID and site induction completed",
    "Job specific PPE checked — Helmet, Shoes, Vest, Gloves, Goggles",
    "Lifting equipment & tackles have valid test certificate",
    "Tools & equipment inspected and in good condition",
    "Competent operator/rigger available for lifting",
    "Fall protection provided for work above 1.8m height",
    "Emergency contact numbers displayed at site",
    "Excavation edges protected, shoring provided if >1.5m deep",
    "First aid box available at workplace",
    "Scaffolding checked and tagged if used",
    "Proper illumination provided for work",
    "Proper access and egress arranged?",
    "Housekeeping ensured before, during & after work",
  ],
  HEIGHT: [
    "Has a Work method statement and Risk Assessment been carried out specifically identifying the risks associated with work at height?",
    "Are all workers passed the height pass test?",
    "Have the Risk Assessment & Control Measures/Actions been implemented?",
    "Are appropriate PPEs provided to every one involved in work at height activity? (Safety harness, fall arrester etc.)",
    "Has all plant and equipment to be used been maintained, serviced and checked to ensure it is safe to use?",
    "Every open side or opening into or through which a person may fall is covered or guarded by an effective barrier to prevent falls",
    "Where covers are used for openings, are these covers securely fixed to prevent accidental displacement?",
    "Is Toolbox Talk conducted before start of activity?",
    "Safe means of access/egress provided?",
    "Scaffolding with Green tag?",
    "Ladder at safe angle and secured at top and bottom, 1 meter above the landing platform?",
    "No access zones below?",
    "Vertical ladder — if more than 6 meters height, rope grab fall arrestor with polyamide rope is provided?",
    "Are required Danger/Warning/Caution/awareness signages provided?",
    "Ensure no material stacked in the vicinity of working area — at least 1 meter distance from edge",
    "Is work area provided with proper illumination?",
    "Are all practicable precautions taken to eliminate or reduce the risk of Working at Heights?",
    "Are All personal involved in this activity undergone Work at height training?",
    "Is safety net provided as per the instruction mentioned in OCP?",
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

/**
 * Client-side sanity check for a permit's Valid From – To pair.
 *
 * Most permit types are same-day: startTime must be strictly before endTime
 * (as HH:MM strings; zero-padding makes lexicographic comparison correct).
 * Night Work permits deliberately cross midnight — a 22:00 → 02:00 slab-pour
 * shift is normal — so the check relaxes to "not equal" for that type.
 * Called from the form's Step-1 gate + Submit guard so the two paths agree.
 */
export function isValidPermitTimeWindow(
  type: WorkPermitType,
  startTime: string,
  endTime: string,
): boolean {
  if (type === "NIGHT_WORK") return startTime !== endTime;
  return startTime < endTime;
}

/**
 * Colab-parity human-readable permit id shown on cards, headers, and
 * outbound emails: PER-XXXXXXXX with 8 uppercase alphanumerics.
 * The random suffix is unique per project (enforced by the DB), so
 * collisions on the ~93-villa scale are astronomically unlikely; we
 * still let the DB catch any freak duplicate.
 */
export function generatePermitDisplayId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 (harder to misread on paper)
  let s = "PER-";
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}
