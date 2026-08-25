import { describe, it, expect } from "vitest";
import {
  TRADES,
  tradeOrder,
  toDay,
  plannedCountFor,
  actualCountFor,
  daySummary,
  rangeSummary,
  dashboardStrip,
  type TradePlanRow,
  type ManpowerEntryRow,
} from "@/lib/manpower";

const d = (iso: string) => new Date(iso + "T00:00:00Z");

const AT = "contractor-abraham-thomas";
const TBD = "contractor-tbd";

describe("TRADES + tradeOrder", () => {
  it("has the four Amanvana trades in display order", () => {
    expect(TRADES).toEqual(["Bar Bender", "Carpenter", "Helper", "Mason"]);
  });

  it("orders known trades by their index", () => {
    expect(tradeOrder("Bar Bender")).toBe(0);
    expect(tradeOrder("Carpenter")).toBe(1);
    expect(tradeOrder("Helper")).toBe(2);
    expect(tradeOrder("Mason")).toBe(3);
  });

  it("puts unknown trades last", () => {
    expect(tradeOrder("Painter")).toBe(TRADES.length);
  });
});

describe("toDay", () => {
  it("truncates time-of-day to UTC midnight", () => {
    const noon = new Date("2026-08-25T14:32:11Z");
    expect(toDay(noon).toISOString()).toBe("2026-08-25T00:00:00.000Z");
  });

  it("is idempotent", () => {
    const day = toDay(new Date("2026-08-25T14:00:00Z"));
    expect(toDay(day).getTime()).toBe(day.getTime());
  });
});

describe("plannedCountFor", () => {
  const plans: TradePlanRow[] = [
    { contractorId: AT, trade: "Helper", plannedCount: 15, startDate: d("2026-01-01"), endDate: null },
    { contractorId: AT, trade: "Mason",  plannedCount: 4,  startDate: d("2026-01-01"), endDate: null },
    { contractorId: TBD, trade: "Helper", plannedCount: 20, startDate: d("2026-01-01"), endDate: null },
  ];

  it("finds the count for a matching (contractor, trade, date)", () => {
    expect(plannedCountFor(plans, AT, "Helper", d("2026-08-25"))).toBe(15);
  });

  it("returns 0 when no plan matches the contractor", () => {
    expect(plannedCountFor(plans, "unknown", "Helper", d("2026-08-25"))).toBe(0);
  });

  it("returns 0 when no plan matches the trade", () => {
    expect(plannedCountFor(plans, AT, "Carpenter", d("2026-08-25"))).toBe(0);
  });

  it("respects an open-ended plan (endDate null) on any date after start", () => {
    expect(plannedCountFor(plans, AT, "Helper", d("2029-12-31"))).toBe(15);
  });

  it("returns 0 for dates before the plan starts", () => {
    expect(plannedCountFor(plans, AT, "Helper", d("2025-12-31"))).toBe(0);
  });

  it("respects a bounded plan endDate (exclusive upper bound)", () => {
    const bounded: TradePlanRow[] = [
      { contractorId: AT, trade: "Helper", plannedCount: 10, startDate: d("2026-08-01"), endDate: d("2026-08-25") },
    ];
    expect(plannedCountFor(bounded, AT, "Helper", d("2026-08-24"))).toBe(10);
    // endDate is exclusive — on the endDate itself the plan is no longer effective.
    expect(plannedCountFor(bounded, AT, "Helper", d("2026-08-25"))).toBe(0);
  });

  it("when two plans overlap, the most-recent-start wins", () => {
    const overlapping: TradePlanRow[] = [
      { contractorId: AT, trade: "Helper", plannedCount: 10, startDate: d("2026-01-01"), endDate: null },
      { contractorId: AT, trade: "Helper", plannedCount: 15, startDate: d("2026-07-01"), endDate: null },
    ];
    expect(plannedCountFor(overlapping, AT, "Helper", d("2026-08-25"))).toBe(15);
  });
});

describe("actualCountFor", () => {
  const entries: ManpowerEntryRow[] = [
    { contractorId: AT, trade: "Helper", entryDate: d("2026-08-25"), actualCount: 18 },
    { contractorId: AT, trade: "Mason",  entryDate: d("2026-08-25"), actualCount: 4 },
    { contractorId: AT, trade: "Helper", entryDate: d("2026-08-24"), actualCount: 15 },
  ];

  it("finds the entry for a matching (contractor, trade, date)", () => {
    expect(actualCountFor(entries, AT, "Helper", d("2026-08-25"))).toBe(18);
  });

  it("returns 0 when no entry matches", () => {
    expect(actualCountFor(entries, AT, "Carpenter", d("2026-08-25"))).toBe(0);
    expect(actualCountFor(entries, TBD, "Helper",   d("2026-08-25"))).toBe(0);
    expect(actualCountFor(entries, AT, "Helper",    d("2026-08-23"))).toBe(0);
  });

  it("matches by day even when times differ", () => {
    const entriesWithTime: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Helper", entryDate: new Date("2026-08-25T14:32:11Z"), actualCount: 18 },
    ];
    expect(actualCountFor(entriesWithTime, AT, "Helper", d("2026-08-25"))).toBe(18);
  });
});

describe("daySummary", () => {
  const plans: TradePlanRow[] = [
    { contractorId: AT, trade: "Bar Bender", plannedCount: 12, startDate: d("2026-01-01"), endDate: null },
    { contractorId: AT, trade: "Carpenter",  plannedCount: 12, startDate: d("2026-01-01"), endDate: null },
    { contractorId: AT, trade: "Helper",     plannedCount: 15, startDate: d("2026-01-01"), endDate: null },
    { contractorId: AT, trade: "Mason",      plannedCount: 4,  startDate: d("2026-01-01"), endDate: null },
  ];

  it("with no entries yet, returns full plan and 0 actual", () => {
    const s = daySummary(plans, [], d("2026-08-25"));
    expect(s.plannedTotal).toBe(43);
    expect(s.actualTotal).toBe(0);
    expect(s.variance).toBe(-43);
    expect(s.pctOfPlan).toBe(0);
    expect(s.hasEntries).toBe(false);
    expect(s.trades.length).toBe(4);
  });

  it("computes pctOfPlan correctly when actuals meet plan (matches Aug 23 scorecard: 50/43 = 116%)", () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Bar Bender", entryDate: d("2026-08-25"), actualCount: 12 },
      { contractorId: AT, trade: "Carpenter",  entryDate: d("2026-08-25"), actualCount: 19 },
      { contractorId: AT, trade: "Helper",     entryDate: d("2026-08-25"), actualCount: 15 },
      { contractorId: AT, trade: "Mason",      entryDate: d("2026-08-25"), actualCount: 4 },
    ];
    const s = daySummary(plans, entries, d("2026-08-25"));
    expect(s.plannedTotal).toBe(43);
    expect(s.actualTotal).toBe(50);
    expect(s.variance).toBe(7);
    expect(s.pctOfPlan).toBe(116);
    expect(s.hasEntries).toBe(true);
  });

  it("surfaces trades that logged actuals without a plan", () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Painter", entryDate: d("2026-08-25"), actualCount: 3 },
    ];
    const s = daySummary(plans, entries, d("2026-08-25"));
    const painter = s.trades.find((t) => t.trade === "Painter");
    expect(painter?.planned).toBe(0);
    expect(painter?.actual).toBe(3);
    // pctOfPlan is null (not 0, not Infinity) so the UI can show "—" instead of "0%"
    expect(painter?.pctOfPlan).toBe(null);
  });

  it("filters to a single contractor when contractorId is passed", () => {
    const plansMulti: TradePlanRow[] = [
      ...plans,
      { contractorId: TBD, trade: "Helper", plannedCount: 20, startDate: d("2026-01-01"), endDate: null },
    ];
    const s = daySummary(plansMulti, [], d("2026-08-25"), AT);
    expect(s.plannedTotal).toBe(43);
    expect(s.trades.every((t) => t.contractorId === AT)).toBe(true);
  });

  it("plannedTotal is 0 (not NaN) when a contractor has no plan yet", () => {
    const s = daySummary([], [], d("2026-08-25"), TBD);
    expect(s.plannedTotal).toBe(0);
    expect(s.actualTotal).toBe(0);
    expect(s.pctOfPlan).toBe(null); // divide-by-zero guard
    expect(s.trades).toEqual([]);
  });

  it("sorts trades by (contractor, canonical trade order)", () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Mason",      entryDate: d("2026-08-25"), actualCount: 4 },
      { contractorId: AT, trade: "Bar Bender", entryDate: d("2026-08-25"), actualCount: 12 },
    ];
    const s = daySummary(plans, entries, d("2026-08-25"));
    const order = s.trades.map((t) => t.trade);
    expect(order).toEqual(["Bar Bender", "Carpenter", "Helper", "Mason"]);
  });
});

describe("rangeSummary", () => {
  const plans: TradePlanRow[] = [
    { contractorId: AT, trade: "Helper", plannedCount: 15, startDate: d("2026-01-01"), endDate: null },
  ];

  it("returns one summary per day, inclusive of both endpoints", () => {
    const days = rangeSummary(plans, [], d("2026-08-17"), d("2026-08-23"));
    expect(days.length).toBe(7);
    expect(days[0].date.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(days[6].date.toISOString()).toBe("2026-08-23T00:00:00.000Z");
  });

  it("returns an empty array when toDate is before fromDate", () => {
    expect(rangeSummary(plans, [], d("2026-08-23"), d("2026-08-17"))).toEqual([]);
  });

  it("single-day range returns exactly one entry", () => {
    const days = rangeSummary(plans, [], d("2026-08-25"), d("2026-08-25"));
    expect(days.length).toBe(1);
  });
});

describe("dashboardStrip", () => {
  const plans: TradePlanRow[] = [
    { contractorId: AT, trade: "Helper", plannedCount: 15, startDate: d("2026-01-01"), endDate: null },
    { contractorId: AT, trade: "Mason",  plannedCount: 4,  startDate: d("2026-01-01"), endDate: null },
  ];

  it('status "not-logged" when a plan exists but no entries were made', () => {
    expect(dashboardStrip(plans, [], d("2026-08-25")).status).toBe("not-logged");
  });

  it('status "no-plan" when no plan is effective for the day', () => {
    expect(dashboardStrip([], [], d("2026-08-25")).status).toBe("no-plan");
  });

  it('status "above" when actual > planned', () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Helper", entryDate: d("2026-08-25"), actualCount: 18 },
      { contractorId: AT, trade: "Mason",  entryDate: d("2026-08-25"), actualCount: 4 },
    ];
    const s = dashboardStrip(plans, entries, d("2026-08-25"));
    expect(s.status).toBe("above");
    expect(s.variance).toBe(3);
  });

  it('status "on-plan" when actual == planned', () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Helper", entryDate: d("2026-08-25"), actualCount: 15 },
      { contractorId: AT, trade: "Mason",  entryDate: d("2026-08-25"), actualCount: 4 },
    ];
    expect(dashboardStrip(plans, entries, d("2026-08-25")).status).toBe("on-plan");
  });

  it('status "below" when actual < planned', () => {
    const entries: ManpowerEntryRow[] = [
      { contractorId: AT, trade: "Helper", entryDate: d("2026-08-25"), actualCount: 10 },
      { contractorId: AT, trade: "Mason",  entryDate: d("2026-08-25"), actualCount: 4 },
    ];
    const s = dashboardStrip(plans, entries, d("2026-08-25"));
    expect(s.status).toBe("below");
    expect(s.variance).toBe(-5);
  });
});
