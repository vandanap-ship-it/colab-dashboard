// Canonical "today" in India Standard Time (UTC+5:30) for report boundaries.
//
// Every ProgressEntry / ManpowerEntry / TradePlan / Hindrance stores its date
// as UTC midnight for a calendar day (e.g. 2026-08-27T00:00:00Z represents
// "Aug 27"). The site team is in India — "today" for them starts at IST
// midnight, not UTC midnight. Using naive UTC boundaries makes the reports
// show yesterday's data between 00:00 and 05:30 IST.
//
// This helper returns the IST-anchored UTC midnight for any point in time.
// Use it everywhere the daily/weekly reports (or their default dates) need
// to know what "today" is.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns the UTC-midnight Date that represents the IST calendar day of `d`.
 * `d` defaults to now. Example: 2026-08-26T21:30:00Z (03:00 IST on Aug 27)
 * returns 2026-08-27T00:00:00Z.
 */
export function istDayStart(d: Date = new Date()): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** ISO YYYY-MM-DD for the IST calendar day of `d`. */
export function istDayString(d: Date = new Date()): string {
  return istDayStart(d).toISOString().slice(0, 10);
}
