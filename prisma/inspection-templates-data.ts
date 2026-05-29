/**
 * Curated White Lotus inspection checklist templates.
 *
 * These are transcribed verbatim from the official White Lotus QA/QC checklist
 * document. Only checklists transcribed with full accuracy are included here —
 * we deliberately do NOT bulk-import from the PDF's text layer because its
 * multi-line cells don't extract cleanly and would introduce errors.
 *
 * To add more: append an entry below (code must be unique) and re-run the
 * seed (POST /api/admin/seed-inspection-templates). Upsert by code, so it's
 * safe to run repeatedly.
 */

export type TemplateSeed = {
  code: string;
  name: string;
  activity?: string;
  module?: "QAQC" | "SAFETY";
  orderIndex: number;
  items: { seq: number; section?: string; description: string }[];
};

export const INSPECTION_TEMPLATES: TemplateSeed[] = [
  {
    code: "CL-QC-01",
    name: "Marking / Setting Out",
    activity: "MARKING",
    module: "QAQC",
    orderIndex: 1,
    items: [
      {
        seq: 1,
        description:
          "Checked and ensured approved GFC drawing with name, date and number of the drawing is available?",
      },
      {
        seq: 2,
        section: "Setting Out",
        description:
          "Check the approved site plans and setting out drawings for dimensional correctness and clarity",
      },
      { seq: 3, section: "Setting Out", description: "Has site been cleared and levelled as per requirement" },
      { seq: 4, section: "Setting Out", description: "Are the required tools and equipments available for marking" },
      {
        seq: 5,
        section: "Setting Out",
        description: "Calibration of the instruments are done and dates are valid at the time of using",
      },
      {
        seq: 6,
        section: "Setting Out",
        description: "TBM's are established and cross checked from the permanent bench marks",
      },
      { seq: 7, section: "Setting Out", description: "Are all set back distances as per setting out drawing, if any" },
      { seq: 8, section: "Setting Out", description: "Are all set back pillars at the same level, if any" },
      {
        seq: 9,
        section: "Setting Out",
        description:
          "Spacing between two consecutive pillars (if any) is restricted to a lesser distance to avoid tape sagging errors and control on grid pillars",
      },
      { seq: 10, section: "Setting Out", description: "Ensured the marking pillars are constructed rigid and safe" },
      {
        seq: 11,
        section: "Setting Out",
        description: "Ensured a layer of PCC as levelling course is done for marking the pillars",
      },
      {
        seq: 12,
        section: "Setting Out",
        description: "Ensured step down pillars for the sloping ground as directed by the client representative",
      },
      {
        seq: 13,
        section: "Setting Out",
        description: "Ensured grid lines of the pillars are marked almost at the centre of the pillar",
      },
      {
        seq: 14,
        section: "Setting Out",
        description: "Ensured the name of the grid pillar has been painted on the marking pillar",
      },
      {
        seq: 15,
        section: "Setting Out",
        description: "Ensured the thickness of the marking line is of the same thickness on the pillar",
      },
      {
        seq: 16,
        section: "Setting Out",
        description: "Ensured marking pillars are plastered, white washed, barricaded and protected",
      },
      {
        seq: 17,
        section: "Setting Out",
        description: "Ensured traverse closing and setting out are cross checked by PMC / Consultants",
      },
      {
        seq: 18,
        section: "Setting Out",
        description:
          "Set backs are checked and verified by PMC / Client. Any deviations observed are informed to Structural / Architectural consultants for approval",
      },
      { seq: 19, section: "Post-Execution Checks", description: "Are the markings protected" },
      { seq: 20, section: "Post-Execution Checks", description: "Are the markings done as per the latest revised drawing" },
    ],
  },
];
