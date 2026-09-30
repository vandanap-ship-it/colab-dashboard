import { describe, it, expect } from "vitest";
import {
  bucketPermit,
  sortDirectionForTab,
  startOfLocalDay,
} from "@/lib/permitBuckets";

/**
 * Fixed anchor date used for all bucket tests. Using a stable `now`
 * removes calendar-day flakiness — the test asserts the same thing
 * whether it runs at midnight IST or 4pm UTC.
 */
const NOW = new Date("2026-09-30T10:00:00+05:30"); // Amanvana IST
const TODAY_ISO = "2026-09-30T00:00:00+05:30";
const YESTERDAY_ISO = "2026-09-29T00:00:00+05:30";
const TOMORROW_ISO = "2026-10-01T00:00:00+05:30";
const NEXT_WEEK_ISO = "2026-10-07T00:00:00+05:30";

describe("startOfLocalDay", () => {
  it("returns the same timestamp for two moments on the same local day", () => {
    const morning = startOfLocalDay("2026-09-30T09:00:00+05:30");
    const evening = startOfLocalDay("2026-09-30T22:30:00+05:30");
    expect(morning).toBe(evening);
  });

  it("accepts a Date instance as well as an ISO string", () => {
    const a = startOfLocalDay("2026-09-30T09:00:00+05:30");
    const b = startOfLocalDay(new Date("2026-09-30T09:00:00+05:30"));
    expect(a).toBe(b);
  });
});

describe("bucketPermit", () => {
  it("CLOSED → closed regardless of workDate", () => {
    expect(bucketPermit({ status: "CLOSED", workDate: TODAY_ISO }, NOW)).toBe("closed");
    expect(bucketPermit({ status: "CLOSED", workDate: NEXT_WEEK_ISO }, NOW)).toBe("closed");
  });

  it("SUSPENDED → suspended regardless of workDate", () => {
    expect(bucketPermit({ status: "SUSPENDED", workDate: TODAY_ISO }, NOW)).toBe("suspended");
    expect(bucketPermit({ status: "SUSPENDED", workDate: TOMORROW_ISO }, NOW)).toBe("suspended");
  });

  it("REJECTED → rejected regardless of workDate", () => {
    expect(bucketPermit({ status: "REJECTED", workDate: TODAY_ISO }, NOW)).toBe("rejected");
    expect(bucketPermit({ status: "REJECTED", workDate: YESTERDAY_ISO }, NOW)).toBe("rejected");
  });

  it("PENDING → active for any workDate (waiting on approval today or tomorrow)", () => {
    expect(bucketPermit({ status: "PENDING", workDate: TODAY_ISO }, NOW)).toBe("active");
    expect(bucketPermit({ status: "PENDING", workDate: TOMORROW_ISO }, NOW)).toBe("active");
    expect(bucketPermit({ status: "PENDING", workDate: YESTERDAY_ISO }, NOW)).toBe("active");
  });

  it("APPROVED with workDate == today → active (crew is working today)", () => {
    expect(bucketPermit({ status: "APPROVED", workDate: TODAY_ISO }, NOW)).toBe("active");
  });

  it("APPROVED with workDate in the past → active (still-open authorization)", () => {
    expect(bucketPermit({ status: "APPROVED", workDate: YESTERDAY_ISO }, NOW)).toBe("active");
  });

  it("APPROVED with workDate tomorrow → future", () => {
    expect(bucketPermit({ status: "APPROVED", workDate: TOMORROW_ISO }, NOW)).toBe("future");
  });

  it("APPROVED with workDate next week → future", () => {
    expect(bucketPermit({ status: "APPROVED", workDate: NEXT_WEEK_ISO }, NOW)).toBe("future");
  });

  it("boundary: APPROVED with workDate exactly at midnight today is active (not future)", () => {
    // Exactly today, not "after today" → active. Confirms the > (not >=)
    // comparison the bucket uses.
    expect(bucketPermit({ status: "APPROVED", workDate: TODAY_ISO }, NOW)).toBe("active");
  });

  it("unknown status falls through to active (defensive)", () => {
    // An unexpected status string shouldn't blow up the list; treat it
    // as active so the row stays visible on the primary tab.
    expect(bucketPermit({ status: "DRAFT" as string, workDate: TODAY_ISO }, NOW)).toBe("active");
  });
});

describe("sortDirectionForTab", () => {
  it("Future sorts ascending (next-up first)", () => {
    expect(sortDirectionForTab("future")).toBe(1);
  });

  it("Active, Closed, Suspended, Rejected sort descending (latest first)", () => {
    expect(sortDirectionForTab("active")).toBe(-1);
    expect(sortDirectionForTab("closed")).toBe(-1);
    expect(sortDirectionForTab("suspended")).toBe(-1);
    expect(sortDirectionForTab("rejected")).toBe(-1);
  });
});
