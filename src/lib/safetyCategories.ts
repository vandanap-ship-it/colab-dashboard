// Canonical safety incident categories — standard construction industry set.
// Used on the Safety tab (Incident Categories section) and available as
// dropdown values when logging an Issue with module=SAFETY.

export const SAFETY_CATEGORIES = [
  { code: "FAC",       label: "FAC",              description: "First Aid Case — minor injury treated on site" },
  { code: "LTI",       label: "LTI",              description: "Lost Time Incident — worker missed a shift" },
  { code: "MTC",       label: "MTC",              description: "Medical Treatment Case — required a doctor" },
  { code: "NEAR_MISS", label: "Near Miss",        description: "Incident that could have caused harm but didn't" },
  { code: "PROPERTY",  label: "Property Damage",  description: "Damage to equipment, materials, or structure" },
  { code: "FATALITY",  label: "Fatality",         description: "Fatal incident (never expected — always investigate)" },
  { code: "ENV",       label: "Environmental",    description: "Spill / leak / emission / contamination event" },
  { code: "FIRE",      label: "Fire",             description: "Fire, explosion, or hot-work incident" },
  { code: "ILLNESS",   label: "Illness",          description: "Occupational illness or exposure" },
  { code: "OTHER",     label: "Other",            description: "Anything not covered above" },
] as const;

export type SafetyCategoryCode = (typeof SAFETY_CATEGORIES)[number]["code"];

export function safetyCategoryLabel(code: string | null | undefined): string {
  if (!code) return "Uncategorised";
  return SAFETY_CATEGORIES.find((c) => c.code === code)?.label ?? code;
}
