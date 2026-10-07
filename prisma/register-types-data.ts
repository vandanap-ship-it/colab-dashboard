/**
 * Register type definitions — the source of truth for every tabular
 * register the site team keeps (fire extinguishers today; equipment,
 * scaffold tags, PPE issuance later). Upserted by code on every build via
 * scripts/seed-inspection-templates.ts, same as the checklist library, so
 * adding a register type or a column is a data-file change, not a schema
 * migration.
 *
 * Column keys are persisted inside RegisterRow.values. Renaming a key
 * orphans existing values — add a new key instead and leave the old one
 * in place until the data is migrated.
 */
import type { RegisterTypeDefinition } from "../src/lib/registers";

export const REGISTER_TYPES: RegisterTypeDefinition[] = [
  {
    // Source: "03 (b). Checklist - Inventory of Fire Extinguisher.xlsx"
    // from the safety team's 2026-10-07 zip. 5 columns, Prepared By (EHS
    // Manager / Officer) + Reviewed & Approved By (Project Head) footer.
    // Shraddha 2026-10-07: Girish approves in Siddhi; "Project Head" stays
    // as the printed label. Monthly sign-off.
    code: "REG-SAF-01",
    name: "Inventory of Fire Extinguishers",
    shortName: "Fire extinguishers",
    module: "SAFETY",
    orderIndex: 10,
    identifierKey: "idNumber",
    dueDateKey: "nextDueDate",
    lastInspectedKey: "lastInspectedOn",
    // IS 2190 calls for quarterly inspection. Shraddha left the interval
    // to us 2026-10-07; it only pre-fills the due date and is editable
    // per row.
    defaultIntervalDays: 90,
    signOffIntervalDays: 30,
    // The Fire Extinguishers (Hazard) checklist — approving one for a
    // given extinguisher rolls that row's dates forward.
    inspectionTemplateCode: "CL-SAF-03",
    preparedByLabel: "EHS Manager / Officer",
    approvedByLabel: "Project Head",
    columns: [
      {
        key: "idNumber",
        label: "Identification Number",
        kind: "text",
        required: true,
        placeholder: "e.g. FE-07",
      },
      {
        key: "location",
        label: "Location",
        kind: "text",
        required: true,
        placeholder: "e.g. Labour camp – near main gate",
      },
      {
        key: "typeCapacity",
        label: "Type & Capacity",
        kind: "select",
        required: true,
        allowOther: true,
        options: [
          "ABC (DCP) 2 kg",
          "ABC (DCP) 4 kg",
          "ABC (DCP) 6 kg",
          "ABC (DCP) 9 kg",
          "CO₂ 2 kg",
          "CO₂ 4.5 kg",
          "CO₂ 9 kg",
          "Foam 9 L",
          "Water 9 L",
          "Clean Agent 2 kg",
        ],
      },
      {
        key: "lastInspectedOn",
        label: "Date of Last Inspection",
        kind: "date",
        required: true,
      },
      {
        key: "nextDueDate",
        label: "Due Date for Next Inspection",
        kind: "date",
        required: true,
      },
    ],
  },
];
