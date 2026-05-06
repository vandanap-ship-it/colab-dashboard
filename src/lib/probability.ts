/**
 * On-Time Probability — computed from total delay (days).
 *
 * Locked formula:
 *   ≤ 0 days delay  → High   (on / ahead of schedule)
 *   1–30 days       → Medium
 *   > 30 days       → Low
 */

export type ProbabilityLevel = "HIGH" | "MEDIUM" | "LOW";

export type ProbabilityInfo = {
  level: ProbabilityLevel;
  label: "High" | "Medium" | "Low";
  /** Tailwind classes for a chip-style badge. */
  pillClass: string;
  /** Hex / rgb color for charts and PDF. */
  color: string;
};

export function probabilityFromDelay(delayDays: number | null | undefined): ProbabilityInfo {
  const days = delayDays ?? 0;

  if (days <= 0) {
    return {
      level: "HIGH",
      label: "High",
      pillClass: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
      color: "#059669",
    };
  }
  if (days <= 30) {
    return {
      level: "MEDIUM",
      label: "Medium",
      pillClass: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
      color: "#d97706",
    };
  }
  return {
    level: "LOW",
    label: "Low",
    pillClass: "bg-red-50 text-red-700 ring-1 ring-red-200",
    color: "#dc2626",
  };
}
