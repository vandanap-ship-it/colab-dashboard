// Fixed mitigation-plan template per delay-reason code. Sourced from the
// Weekly Site Progress PDF Shraddha shared (Aug 17-23 Amanvana) — she
// treats these as canonical guidance to project managers, so we hardcode
// the exact wording as a starting point. Admin can override per project
// later if needed (schema doesn't support that yet — future work).

import type { HindranceReasonCode } from "@/lib/hindranceReasons";

export const REASON_MITIGATIONS: Record<HindranceReasonCode | "UNSPECIFIED", string> = {
  DESIGN:
    "Freeze design and close all open change orders before the next structural stage; get design sign-off dated.",
  LABOUR:
    "Top up the short trades to planned headcount; hold the contractor to the daily labour histogram.",
  MATERIAL:
    "Expedite the open PO / procurement; confirm delivery date and pre-stage material at site block.",
  APPROVAL:
    "Escalate pending approvals with a dated commitment; move dependent activities out of the critical path where possible.",
  RMC:
    "Re-book the RMC slot; confirm truck delivery time and hold curing plan in writing.",
  COORDINATION:
    "Run a coordination huddle between the affected trades; document the sequenced hand-off and enforce with the daily checklist.",
  WEATHER:
    "Add weather contingency to the affected activity; protect the works and resequence indoor tasks on wet days.",
  OTHER:
    "Log a specific cause under the correct reason code so the right mitigation can be applied.",
  UNSPECIFIED:
    "Update the hindrance record with a specific reason so the correct mitigation can be applied.",
};

export function mitigationFor(code: string | null | undefined): string {
  const key = code as keyof typeof REASON_MITIGATIONS;
  return REASON_MITIGATIONS[key] ?? REASON_MITIGATIONS.UNSPECIFIED;
}
