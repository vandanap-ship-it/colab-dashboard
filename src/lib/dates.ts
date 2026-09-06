/**
 * Shared date formatting for the UI.
 *
 * The "02 Jun 2026" day/month/year style was redefined as a private `fmt` in a
 * dozen components; this is the single source for it. Returns an em-dash
 * placeholder for missing dates, matching what those components already showed.
 *
 * Pinned to Asia/Kolkata (IST). Every user of Siddhi is a White Lotus team
 * member in Bangalore, so displaying in the browser's local zone is a bug —
 * a snag `createdAt` of 21:30 UTC (03:00 IST next day) renders as one
 * calendar day on a server that runs in UTC (Vercel) and a different
 * calendar day on the site engineer's IST phone, causing React hydration
 * warnings and legitimate confusion when a night-shift entry appears
 * "yesterday" in the master report.
 */
export function formatDayMonthYear(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Date + time (e.g. "02 Jun 2026, 14:32"). Also pinned to IST for the same
 * reason as formatDayMonthYear — a snag `createdAt` at 21:30 UTC (03:00
 * IST next morning) should show its IST calendar day + IST wall-clock time,
 * not whatever the caller's browser happens to think is local.
 *
 * Used by pages that show audit-style "when did this happen" timestamps —
 * audit log, trash log, activity feeds. If you're only rendering a date
 * (no time), use formatDayMonthYear instead.
 */
export function formatDayMonthYearTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}
