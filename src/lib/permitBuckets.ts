/**
 * Colab-parity permit-list buckets (Abhishek zip 2026-09-30 · 5-tab
 * list). The mental model is "which permits are running / next / done
 * / paused / rejected", not the raw state machine, so we pivot the
 * status counts into 5 named tabs. Pure functions — testable in
 * isolation from the React client.
 */

import type { WorkPermitStatus } from "@/lib/workPermit";

export type PermitTabKey = "active" | "future" | "closed" | "suspended" | "rejected";

/** Compute the local-day timestamp (midnight, ms since epoch) for an ISO
 *  or Date input. Used by the bucket + sort to compare workDate against
 *  "today" without a timezone drift. */
export function startOfLocalDay(input: string | Date): number {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayStart(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket a permit into one of the 5 Colab-parity tabs. Terminal statuses
 * (CLOSED/SUSPENDED/REJECTED) map straight through. PENDING permits and
 * APPROVED-with-workDate-today-or-past land on Active. APPROVED with
 * workDate in the FUTURE (relative to `now`) lands on Future.
 *
 * `now` is injectable for deterministic tests (real callers pass the
 * default `new Date()`).
 */
export function bucketPermit(
  p: { status: string; workDate: string | Date },
  now: Date = new Date(),
): PermitTabKey {
  const status = p.status as WorkPermitStatus;
  if (status === "CLOSED") return "closed";
  if (status === "SUSPENDED") return "suspended";
  if (status === "REJECTED") return "rejected";
  const workStart = startOfLocalDay(p.workDate);
  if (status === "APPROVED" && workStart > todayStart(now)) return "future";
  return "active";
}

/**
 * Sort direction per tab. Future shows next-up first (workDate asc);
 * every other tab reads most-recent first (workDate desc) — a done /
 * paused / rejected reviewer wants the latest at the top; a scheduler
 * scanning Future wants tomorrow before next week.
 */
export function sortDirectionForTab(tab: PermitTabKey): 1 | -1 {
  return tab === "future" ? 1 : -1;
}

/**
 * Ordered tab strip config for the permit list. Matches Colab's Abhishek
 * zip screens 3-9. Kept alongside the bucket function so a new tab
 * lands in both places at once (or not at all).
 */
export const PERMIT_TAB_ORDER: readonly { key: PermitTabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "future", label: "Future" },
  { key: "closed", label: "Closed" },
  { key: "suspended", label: "Suspended" },
  { key: "rejected", label: "Rejected" },
] as const;
