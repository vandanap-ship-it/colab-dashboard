/**
 * Shared date formatting for the UI.
 *
 * The "02 Jun 2026" day/month/year style was redefined as a private `fmt` in a
 * dozen components; this is the single source for it. Returns an em-dash
 * placeholder for missing dates, matching what those components already showed.
 */
export function formatDayMonthYear(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
