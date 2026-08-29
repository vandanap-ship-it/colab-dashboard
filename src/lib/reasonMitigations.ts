// Fixed mitigation-plan template per delay-reason code. Sourced from the
// Weekly Site Progress PDF Shraddha shared (Aug 17-23 Amanvana) — she
// treats these as canonical guidance to project managers, so we hardcode
// the exact wording as a starting point. Admin can override per project
// later if needed (schema doesn't support that yet — future work).

import type { HindranceReasonCode } from "@/lib/hindranceReasons";

export const REASON_MITIGATIONS: Record<HindranceReasonCode | "UNSPECIFIED", string> = {
  CHANGE_ORDER:
    "Freeze design and close all open change orders before the next structural stage; get design sign-off dated.",
  MATERIAL:
    "Expedite the open PO / procurement; confirm delivery date and pre-stage material at site block.",
  LABOUR:
    "Top up the short trades to planned headcount; hold the contractor to the daily labour histogram.",
  PRIORITY_CHANGE:
    "Re-sequence works and confirm the revised priority in writing so the site plan reflects it.",
  MEP_DRAWING:
    "Release pending MEP drawings for the affected villas; coordinate the MEP + civil sequence in writing.",
  DESIGN:
    "Confirm the revised design with the consultant and re-baseline the affected activities before restarting.",
  VENDOR_CHANGE:
    "Complete the new vendor onboarding and issue a revised start date for the affected activity.",
  RMC:
    "Re-book the RMC slot; confirm truck delivery time and hold curing plan in writing.",
  APPROVAL:
    "Escalate pending approvals with a dated commitment; move dependent activities out of the critical path where possible.",
  COORDINATION:
    "Run a coordination huddle between the affected trades; document the sequenced hand-off and enforce with the daily checklist.",
  WEATHER:
    "Add weather contingency to the affected activity; protect the works and resequence indoor tasks on wet days.",
  DELAYED_ENTRY:
    "Clear the access / handover blocker so the crew can start; confirm the entry date in writing.",
  OTHER:
    "Log a specific cause under the correct reason code so the right mitigation can be applied.",
  UNSPECIFIED:
    "Update the hindrance record with a specific reason so the correct mitigation can be applied.",
};

export function mitigationFor(code: string | null | undefined): string {
  const key = code as keyof typeof REASON_MITIGATIONS;
  return REASON_MITIGATIONS[key] ?? REASON_MITIGATIONS.UNSPECIFIED;
}
