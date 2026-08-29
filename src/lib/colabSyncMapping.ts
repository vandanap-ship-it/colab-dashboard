// Mapping table for the one-time CollabTools progress-history import.
//
// CollabTools's progress CSV exports use its own section taxonomy (12 buckets
// via the Sub_Location column). Our MSP schedule uses a different 21-section
// taxonomy per villa. This module maps Colab's rows to the right MSP section
// so the historical progress lands in the correct VillaMilestone / WBSNode.
//
// Mapping approved by Shraddha on 2026-08-28 during V1 launch prep.
// Every "All Floors" rule maps by (Activity_Type, Activity_Head) since Colab's
// "All Floors" bucket is a catch-all for finishing / MEP / handover work that
// splits across many MSP sections.

/** Simple 1:1 lookup for the 11 direct-mapped Sub_Location values. */
const DIRECT_MAPPING: Record<string, string> = {
  "Footing":        "Foundation / Substructure",
  "Pedastal":       "Foundation / Substructure",
  "Raft":           "Foundation / Substructure",
  "Retaining Wall": "Foundation / Substructure",
  "Sub Level":      "Foundation / Substructure",
  "Plinth":         "Plinth Level",
  "Setback":        "Plinth Level",
  "Gr Floor":       "Ground Floor Structure",
  "1st Floor":      "First Floor Structure",
  "2nd Floor":      "Second Floor Structure",
  "Terrace":        "Terrace Works",
};

/**
 * Rules for the "All Floors" bucket. First match wins, so put specific
 * (Head-scoped) rules BEFORE catch-all (Type-only) rules for the same Type.
 */
interface AllFloorsRule {
  type: string;
  head?: string;
  section: string;
}
const ALL_FLOORS_RULES: AllFloorsRule[] = [
  // Staircase — both flavours land in MS Staircase.
  { type: "Interior Finishing", head: "Staircase",            section: "MS Staircase — Detailed Sequence" },
  { type: "MS works",                                          section: "MS Staircase — Detailed Sequence" },

  // Interior Finishing subheads with dedicated sections.
  { type: "Interior Finishing", head: "False Ceiling",        section: "Interior Finishes — Ceilings" },
  { type: "Interior Finishing", head: "Internal Paint",       section: "Internal Paint" },
  { type: "Interior Finishing", head: "Mirror Installation",  section: "Interior Finishes — Bathroom" },

  // Flooring — all subheads.
  { type: "Flooring",                                          section: "Interior Finishes — Flooring" },

  // Doors + Windows.
  { type: "Door & Window Installation",                        section: "Interior Finishes — Doors & Fittings" },

  // Tile & Stone — split by head.
  { type: "Tile & Stone Work",  head: "Countertop",           section: "Interior Finishes — Bathroom" },
  { type: "Tile & Stone Work",  head: "Window Jamb & Sill",   section: "External Development & Cladding" },

  // External Finishing — Paint + canopy Glass go to landscape; the rest to cladding.
  { type: "External Finishing", head: "External Paint",       section: "External Finishes & Landscape" },
  { type: "External Finishing", head: "Glass Railing",        section: "External Finishes & Landscape" },
  { type: "External Finishing",                                section: "External Development & Cladding" },

  // MEP — Lift goes to Lift Works; the "automation" subheads go to Automation;
  // everything else goes to MEP Service Works.
  { type: "MEP",                head: "Lift",                 section: "Lift Works" },
  { type: "MEP",                head: "Home Automation",      section: "Automation, Lighting & Appliances" },
  { type: "MEP",                head: "LED Lighting",         section: "Automation, Lighting & Appliances" },
  { type: "MEP",                head: "Decorative Light",     section: "Automation, Lighting & Appliances" },
  { type: "MEP",                head: "VDP",                  section: "Automation, Lighting & Appliances" },
  { type: "MEP",                head: "Kitchen Appliances",   section: "Automation, Lighting & Appliances" },
  { type: "MEP",                head: "Knobs & Handles",      section: "Automation, Lighting & Appliances" },
  { type: "MEP",                                               section: "MEP Service Works" },

  // Electrical is a distinct Activity_Type in Colab exports (e.g. "Electrical 2nd Fix").
  { type: "Electrical",                                        section: "MEP Service Works" },

  // HVAC + Plumbing — everything under MEP Service Works.
  { type: "HVAC",                                              section: "MEP Service Works" },
  { type: "Plumbing",                                          section: "MEP Service Works" },

  // Handover / commissioning / snagging.
  { type: "Miscellaneous Work",                                section: "Commissioning & Handover" },
];

/**
 * Return the MSP section name a Colab row should land under, or null if the
 * mapping can't be resolved. Caller should log unmatched rows for review.
 */
export function mapColabToMspSection(
  subLocation: string,
  activityType: string,
  activityHead: string,
): string | null {
  const sub = subLocation.trim();
  if (sub !== "All Floors") {
    return DIRECT_MAPPING[sub] ?? null;
  }
  const t = activityType.trim();
  const h = activityHead.trim();
  for (const rule of ALL_FLOORS_RULES) {
    if (rule.type !== t) continue;
    if (rule.head && rule.head !== h) continue;
    return rule.section;
  }
  return null;
}

/**
 * Reason-code mapping for Colab's free-text `Reason_for_Delay`. We normalise
 * to our 12-code HINDRANCE_REASONS taxonomy so the Weekly Report's delay-
 * cluster section can group Colab-imported delays with fresh Siddhi ones.
 * Unknown values pass through as OTHER with the original text kept in
 * reasonNote.
 */
const REASON_KEYWORDS: Array<[RegExp, string]> = [
  [/change\s*(of|in)?\s*(order|vendor|priority)/i, "CHANGE_ORDER"],
  [/priority/i,                                     "PRIORITY_CHANGE"],
  [/vendor/i,                                       "VENDOR_CHANGE"],
  [/mep\s*(drawing|dwg)/i,                          "MEP_DRAWING"],
  [/drawing/i,                                      "MEP_DRAWING"],  // Python folds "drawings" → MEP_DRAWING
  [/design/i,                                       "DESIGN"],
  [/matr?ial|shortage|steel|cement|brick/i,         "MATERIAL"],  // "matrial" is a common Colab typo
  [/labou?r|manpower|skilled|worker|shortage of man/i, "LABOUR"],
  [/rmc|concrete|truck/i,                           "RMC"],
  [/weather|rain|climate/i,                         "WEATHER"],
  [/approv|permit|nod/i,                            "APPROVAL"],
  [/coord|sequenc/i,                                "COORDINATION"],
  [/delayed?\s*entry|access|handover/i,             "DELAYED_ENTRY"],
];

// Meta / noise strings that aren't real delay causes — Python drops these
// (build_wk23.py L26-27, L196). We treat them as null so they don't inflate
// the Weekly §5 reason clusters. Each alternation is anchored to whole
// strings / clear meta-phrases so genuine reasons that happen to contain
// the word "collab" (e.g. "coordination with Collab team") aren't nulled.
const REASON_NOISE_STRINGS = /^(work in progress|none|nan|\.|delayed update|delayed update in collab|late update|late update in colab tools?)$/i;
const REASON_NOISE_PHRASES = /^(update in |delayed update |late update )/i;

export function mapColabReasonToCode(freeText: string): string | null {
  const t = (freeText ?? "").trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (REASON_NOISE_STRINGS.test(low)) return null;
  if (REASON_NOISE_PHRASES.test(low)) return null;
  for (const [re, code] of REASON_KEYWORDS) {
    if (re.test(t)) return code;
  }
  return "OTHER";
}
