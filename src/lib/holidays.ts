// Site holidays — excluded from the manpower working-day denominator per
// RUNBOOK section 3, point 4. Shown as a shaded "HOLIDAY" column in the
// weekly chart and "Hol" in the date-wise table.
//
// Coverage: Karnataka-observed / national public holidays for the current
// launch window. Dates are UTC-midnight ISO strings so equality math is a
// simple substring compare with a Date.toISOString().slice(0, 10) key.
//
// If a project needs a different holiday roster (different state / private
// site holidays), extend by moving this into a project-scoped table. Not
// worth the schema addition for V1 — one project, one calendar.

/** ISO YYYY-MM-DD strings. Extend as needed. */
export const INDIA_HOLIDAYS: ReadonlyArray<string> = [
  "2026-01-26", // Republic Day
  "2026-03-04", // Holi
  "2026-03-19", // Ugadi
  "2026-04-14", // Ambedkar Jayanti
  "2026-05-01", // May Day
  "2026-08-15", // Independence Day (explicit RUNBOOK example)
  "2026-09-15", // Ganesh Chaturthi (approx)
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Vijayadashami / Dussehra
  "2026-11-08", // Diwali (approx)
  "2026-12-25", // Christmas

  "2027-01-01", // New Year
  "2027-01-26", // Republic Day
  "2027-03-22", // Holi
  "2027-04-09", // Ugadi
  "2027-04-14", // Ambedkar Jayanti
  "2027-05-01", // May Day
  "2027-08-15", // Independence Day
  "2027-10-02", // Gandhi Jayanti
  "2027-11-09", // Diwali (approx)
  "2027-12-25", // Christmas
];

const HOLIDAY_SET: ReadonlySet<string> = new Set(INDIA_HOLIDAYS);

/** True if the given calendar day is on the holiday roster. */
export function isHoliday(d: Date | string): boolean {
  const key = typeof d === "string"
    ? d.slice(0, 10)
    : d.toISOString().slice(0, 10);
  return HOLIDAY_SET.has(key);
}
