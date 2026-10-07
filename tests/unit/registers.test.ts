import { describe, it, expect } from "vitest";
import {
  addDays,
  compareIdentifiers,
  daysBetween,
  dueLabel,
  dueState,
  formatIsoDay,
  generateSubmissionDisplayId,
  isIsoDay,
  isSignOffDue,
  normaliseIdentifier,
  parseColumns,
  parseSnapshot,
  parseValues,
  validateRowValues,
} from "@/lib/registers";
import { REGISTER_TYPES } from "../../prisma/register-types-data";

const fe = REGISTER_TYPES.find((t) => t.code === "REG-SAF-01")!;
const keys = { dueDateKey: fe.dueDateKey, lastInspectedKey: fe.lastInspectedKey };
const valid = {
  idNumber: " FE-07 ",
  location: "Labour camp",
  typeCapacity: "ABC (DCP) 6 kg",
  lastInspectedOn: "2026-10-01",
  nextDueDate: "2026-12-30",
};

describe("fire extinguisher register definition", () => {
  it("matches the safety team's Excel columns, in order", () => {
    expect(fe.columns.map((c) => c.label)).toEqual([
      "Identification Number",
      "Location",
      "Type & Capacity",
      "Date of Last Inspection",
      "Due Date for Next Inspection",
    ]);
  });

  it("points its special keys at real columns", () => {
    const colKeys = fe.columns.map((c) => c.key);
    for (const k of [fe.identifierKey, fe.dueDateKey, fe.lastInspectedKey]) {
      expect(colKeys).toContain(k);
    }
    expect(fe.inspectionTemplateCode).toBe("CL-SAF-03");
    expect(fe.signOffIntervalDays).toBe(30);
  });

  it("round-trips through parseColumns unchanged", () => {
    expect(parseColumns(JSON.parse(JSON.stringify(fe.columns)))).toEqual(
      fe.columns.map((c) => ({ ...c, required: c.required === true, allowOther: c.allowOther === true })),
    );
  });
});

describe("validateRowValues", () => {
  it("accepts a complete row and trims values", () => {
    const r = validateRowValues(fe.columns, valid, keys);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.idNumber).toBe("FE-07");
  });

  it("flags every missing required field", () => {
    const r = validateRowValues(fe.columns, {}, keys);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(fe.columns.map((c) => c.key).sort());
  });

  it("rejects impossible dates", () => {
    const r = validateRowValues(fe.columns, { ...valid, lastInspectedOn: "2026-02-30" }, keys);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lastInspectedOn).toMatch(/valid date/);
  });

  it("rejects a due date before the last inspection", () => {
    const r = validateRowValues(fe.columns, { ...valid, nextDueDate: "2026-09-01" }, keys);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.nextDueDate).toMatch(/before the last inspection/);
  });

  it("allows a free-text Type & Capacity because the column allows Other", () => {
    const r = validateRowValues(fe.columns, { ...valid, typeCapacity: "Wet chemical 6 L" }, keys);
    expect(r.ok).toBe(true);
  });

  it("rejects an off-list select value when Other isn't allowed", () => {
    const cols = [{ key: "k", label: "K", kind: "select" as const, required: true, options: ["A"] }];
    expect(validateRowValues(cols, { k: "B" }).ok).toBe(false);
    expect(validateRowValues(cols, { k: "A" }).ok).toBe(true);
  });

  it("drops keys that aren't columns", () => {
    const r = validateRowValues(fe.columns, { ...valid, sneaky: "x" }, keys);
    expect(r.ok && "sneaky" in r.values).toBe(false);
  });
});

describe("dates", () => {
  it("isIsoDay", () => {
    expect(isIsoDay("2026-10-07")).toBe(true);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("7/10/2026")).toBe(false);
  });
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-10-07", 90)).toBe("2027-01-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("daysBetween", () => {
    expect(daysBetween("2026-10-07", "2026-10-14")).toBe(7);
    expect(daysBetween("2026-10-07", "2026-10-01")).toBe(-6);
  });
  it("formatIsoDay", () => {
    expect(formatIsoDay("2026-10-07")).toBe("07 Oct 2026");
    expect(formatIsoDay(null)).toBe("—");
  });
});

describe("dueState / dueLabel", () => {
  const today = "2026-10-07";
  it("overdue starts the day after the due date", () => {
    expect(dueState("2026-10-06", today)).toBe("overdue");
    expect(dueState("2026-10-07", today)).toBe("due_soon");
  });
  it("due soon covers today through 7 days out", () => {
    expect(dueState("2026-10-14", today)).toBe("due_soon");
    expect(dueState("2026-10-15", today)).toBe("ok");
  });
  it("no date → none", () => {
    expect(dueState(undefined, today)).toBe("none");
    expect(dueState("garbage", today)).toBe("none");
  });
  it("labels", () => {
    expect(dueLabel("2026-10-04", today)).toBe("Overdue by 3 days");
    expect(dueLabel("2026-10-06", today)).toBe("Overdue by 1 day");
    expect(dueLabel("2026-10-07", today)).toBe("Due today");
    expect(dueLabel("2026-10-08", today)).toBe("Due in 1 day");
    expect(dueLabel("2026-12-30", today)).toBe("Due 30 Dec 2026");
  });
});

describe("identifiers", () => {
  it("normalise ignores case and spacing", () => {
    expect(normaliseIdentifier("  fe -  07 ")).toBe("FE - 07");
    expect(normaliseIdentifier("fe-07")).toBe(normaliseIdentifier("FE-07"));
  });
  it("sorts naturally so FE-2 comes before FE-10", () => {
    expect(["FE-10", "FE-2", "FE-1"].sort(compareIdentifiers)).toEqual(["FE-1", "FE-2", "FE-10"]);
  });
  it("display ids are INV- plus 8 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(generateSubmissionDisplayId()).toMatch(/^INV-[A-HJ-NP-Z2-9]{8}$/);
  });
});

describe("isSignOffDue", () => {
  const now = new Date("2026-10-07T03:00:00Z");
  it("is due when never signed off and the list has items", () => {
    expect(isSignOffDue(null, 30, now, 5)).toBe(true);
  });
  it("is not due for an empty list", () => {
    expect(isSignOffDue(null, 30, now, 0)).toBe(false);
  });
  it("is due 30 days after the last sign-off, not before", () => {
    expect(isSignOffDue(new Date("2026-09-08T03:00:00Z"), 30, now, 5)).toBe(false);
    expect(isSignOffDue(new Date("2026-09-07T03:00:00Z"), 30, now, 5)).toBe(true);
  });
  it("is never due without an interval", () => {
    expect(isSignOffDue(null, null, now, 5)).toBe(false);
  });
});

describe("parsers", () => {
  it("parseValues keeps strings and numbers only", () => {
    expect(parseValues({ a: "x", b: 3, c: null, d: { e: 1 } })).toEqual({ a: "x", b: "3" });
    expect(parseValues(null)).toEqual({});
  });
  it("parseSnapshot rejects unknown versions and keeps rows", () => {
    expect(parseSnapshot({ version: 2, rows: [] })).toBeNull();
    const snap = parseSnapshot({
      version: 1,
      typeCode: "REG-SAF-01",
      typeName: "Inventory",
      projectName: "Amanvana",
      columns: fe.columns,
      identifierKey: "idNumber",
      preparedByLabel: "EHS",
      approvedByLabel: "Project Head",
      rows: [{ id: "r1", identifier: "FE-1", values: { idNumber: "FE-1" }, villaLabel: null }],
    });
    expect(snap?.rows[0].identifier).toBe("FE-1");
    expect(snap?.columns).toHaveLength(5);
  });
});
