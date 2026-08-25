// Human labels for the Project.projectType free-form-ish column. Keeping a
// canonical list here means the landing table filter, the new-project modal,
// and any future report can agree on the same set of values without churn.

export const PROJECT_TYPES = [
  { code: "VILLA_PROJECT",  label: "Villa Project" },
  { code: "APARTMENT",      label: "Apartment / Tower" },
  { code: "TOWNSHIP",       label: "Township" },
  { code: "COMMERCIAL",     label: "Commercial" },
  { code: "MIXED_USE",      label: "Mixed Use" },
  { code: "INFRASTRUCTURE", label: "Infrastructure" },
  { code: "INTERIOR",       label: "Interior Fit-Out" },
  { code: "OTHER",          label: "Other" },
] as const;

export type ProjectTypeCode = (typeof PROJECT_TYPES)[number]["code"];

export function projectTypeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return PROJECT_TYPES.find((t) => t.code === code)?.label ?? code;
}
