// Delay-reason taxonomy for hindrances. Curated with Shraddha for Amanvana —
// dropdown values the site team picks when logging a blocker, so the Dashboard
// can cluster overdue villas by root cause instead of just counting bodies.
//
// Kept in one place because both the log form (mobile) and the aggregation
// query on the server must agree exactly on the codes.

export const HINDRANCE_REASONS = [
  { code: "CHANGE_ORDER",   label: "Change orders (design/scope)" },
  { code: "MATERIAL",       label: "Material shortage"            },
  { code: "LABOUR",         label: "Skilled labour shortage"      },
  { code: "PRIORITY_CHANGE",label: "Priority change"              },
  { code: "MEP_DRAWING",    label: "MEP drawing delay"            },
  { code: "DESIGN",         label: "Design revision"              },
  { code: "VENDOR_CHANGE",  label: "Vendor change"                },
  { code: "RMC",            label: "RMC slot missed"              },
  { code: "WEATHER",        label: "Weather / climate"            },
  { code: "COORDINATION",   label: "Coordination gap"             },
  { code: "APPROVAL",       label: "Approval pending"             },
  { code: "OTHER",          label: "Other"                        },
] as const;

export type HindranceReasonCode = (typeof HINDRANCE_REASONS)[number]["code"];

export const HINDRANCE_REASON_CODES: Set<string> = new Set(
  HINDRANCE_REASONS.map((r) => r.code),
);

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "Unspecified";
  return HINDRANCE_REASONS.find((r) => r.code === code)?.label ?? code;
}

export function isValidReasonCode(v: unknown): v is HindranceReasonCode {
  return typeof v === "string" && HINDRANCE_REASON_CODES.has(v);
}
