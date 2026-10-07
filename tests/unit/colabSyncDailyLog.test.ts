import { describe, it, expect } from "vitest";
import { importColabProgress } from "@/lib/colabSync";

// In-memory stand-in for the handful of Prisma calls importColabProgress
// makes. Records every write so tests can assert what would hit the DB.
function fakeDb(opts: { nativeEntries?: Array<{ wbsNodeId: string; date: Date }> } = {}) {
  const entries = new Map<string, { id: string; data: Record<string, unknown> }>();
  const photos: Array<{ progressEntryId: string; url: string }> = [];
  const wbsUpdates: unknown[] = [];
  let seq = 0;
  const villas = [
    { id: "v3", number: 3, label: "Villa 03 & 04", unitCount: 2 },
    { id: "v5", number: 5, label: null, unitCount: 1 },
  ];
  const section = { id: "s-found", name: "Foundation / Substructure" };
  const db = {
    villa: { findMany: async () => villas },
    milestoneSection: { findMany: async () => [section] },
    contractor: {
      findMany: async () => [{ id: "c-at", name: "Abraham Thomas" }],
      create: async () => ({ id: "c-new" }),
    },
    villaMilestone: {
      findMany: async () => villas.map((v) => ({ id: `vm-${v.id}`, villaId: v.id, sectionId: section.id })),
      update: async () => ({}),
    },
    wBSNode: {
      findMany: async (args: { cursor?: unknown }) => args.cursor ? [] : villas.map((v) => ({
        id: `w-${v.id}`, name: "Footing Excavation", totalQuantity: 100, unit: "cum",
        villaMilestoneId: `vm-${v.id}`, isSubMilestone: true,
      })),
      findFirst: async () => null,
      update: async (a: unknown) => { wbsUpdates.push(a); return {}; },
      updateMany: async (a: unknown) => { wbsUpdates.push(a); return { count: 0 }; },
    },
    user: { findMany: async () => [{ id: "u-madh", name: "Madhavarajan Soundararajan" }] },
    progressEntry: {
      findMany: async () => opts.nativeEntries ?? [],
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) => {
        const e = entries.get(where.idempotencyKey);
        return e ? { id: e.id } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `pe-${++seq}`;
        entries.set(data.idempotencyKey as string, { id, data });
        return { id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const e of entries.values()) if (e.id === where.id) Object.assign(e.data, data);
        return {};
      },
    },
    progressPhoto: {
      findMany: async ({ where }: { where: { progressEntryId: string; url?: unknown } }) =>
        where.url ? [] : photos.filter((p) => p.progressEntryId === where.progressEntryId),
      create: async ({ data }: { data: { progressEntryId: string; url: string } }) => { photos.push(data); return {}; },
      update: async () => ({}),
    },
    $executeRawUnsafe: async () => 0,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db, entries, photos, wbsUpdates };
}

// Colab's day-by-day log: slash dates, "Actvity_Head" / "Milestone_Type"
// header spellings, daily_id + Progress_added_by columns.
const HEADER = "Project_Name,Progress_added_by,Location_Name,Sub_Location,Sub_Sub_location,Activity_Type,Actvity_Head,Activity_Name,Progress_Date,Actual_Start,Planned_Start_Date,Planned_End_Date,Actual_End_Date,Total_Qty,Achieved_Qty,Cumulative__achieved_Qty,Total__Progress_%,Remark,Image_Link,Milestone,Milestone_Type,Activity_ID,daily_id";
const row = (o: Record<string, string>) => [
  "AMANVANA", o.by ?? "Madhavarajan Soundararajan  (WL-MadhavanS)", o.loc ?? "Villa 05", "Footing", "-",
  "Civil", "Excavation", "Footing Excavation", o.date ?? "18/08/26", "10/08/26", "01/08/26", "30/08/26", "",
  "100", o.ach ?? "10", o.cum ?? "10", o.pct ?? "10", o.remark ?? "", o.img ?? "", "", "", o.act ?? "A1", o.id ?? "1",
].join(",");
const opts = { dryRun: false, createdById: "u-admin", projectName: "AMANVANA", defaultContractorName: "Abraham Thomas" };

describe("importColabProgress — day-by-day log (history only)", () => {
  it("merges same-day updates, keeps every photo, credits the Colab author, never touches activity state", async () => {
    const { db, entries, photos, wbsUpdates } = fakeDb();
    const csv = [
      HEADER,
      row({ ach: "76.72", cum: "76.72", pct: "77", img: "https://node.colabtools.com/uploads/a.jpg", remark: "first", id: "11" }),
      row({ ach: "6.57", cum: "83.29", pct: "84", img: "None/uploads/b.jpg", remark: "second", id: "12" }),
    ].join("\n");
    const stats = await importColabProgress(db, "p1", csv, opts);

    expect(stats.dailyLogRows).toBe(2);
    expect(stats.sameDayMerged).toBe(1);
    expect(stats.progressEntriesCreated).toBe(1);
    const e = entries.get("colab:A1:2026-08-18")!;
    expect(e).toBeDefined();
    expect(e.data.achievedQuantity).toBeCloseTo(83.29);
    expect(e.data.cumulativeQuantity).toBeCloseTo(83.29);
    expect(e.data.notes).toBe("first | second");
    expect(e.data.createdById).toBe("u-madh");
    expect(photos.map((p) => p.url).sort()).toEqual([
      "https://node.colabtools.com/uploads/a.jpg",
      "https://node.colabtools.com/uploads/b.jpg",
    ]);
    expect(wbsUpdates).toEqual([]);
  });

  it("updates an entry the snapshot import already wrote instead of duplicating it, adding only new photos", async () => {
    const { db, entries, photos } = fakeDb();
    const first = [HEADER, row({ img: "https://node.colabtools.com/uploads/a.jpg" })].join("\n");
    await importColabProgress(db, "p1", first, opts);
    const again = [HEADER, row({ ach: "12", cum: "12", img: "https://node.colabtools.com/uploads/a.jpg" })].join("\n");
    const stats = await importColabProgress(db, "p1", again, opts);
    expect(stats.progressEntriesUpdated).toBe(1);
    expect(stats.progressEntriesCreated).toBe(0);
    expect(entries.size).toBe(1);
    expect(entries.get("colab:A1:2026-08-18")!.data.achievedQuantity).toBe(12);
    expect(photos).toHaveLength(1);
  });

  it("maps the second half of an MSP pair and falls back to the importer for unknown authors", async () => {
    const { db, entries } = fakeDb();
    const csv = [HEADER, row({ loc: "Villa 04", by: "Superadmin Whitelotus (whitelotussuperadmin)" })].join("\n");
    const stats = await importColabProgress(db, "p1", csv, opts);
    expect(stats.villaPairAliases).toEqual(["4→3"]);
    expect(stats.unmatchedRows).toBe(0);
    expect(entries.get("colab:A1:2026-08-18")!.data.createdById).toBe("u-admin");
    expect(entries.get("colab:A1:2026-08-18")!.data.wbsNodeId).toBe("w-v3");
  });

  it("Siddhi wins: skips Colab days on/after the team's first Siddhi entry, keeps earlier history", async () => {
    const { db, entries } = fakeDb({ nativeEntries: [{ wbsNodeId: "w-v5", date: new Date("2026-08-18T00:00:00Z") }] });
    const csv = [
      HEADER,
      row({ date: "17/08/26", act: "A1", id: "1" }),
      row({ date: "18/08/26", act: "A1", id: "2" }),
    ].join("\n");
    await importColabProgress(db, "p1", csv, opts);
    expect([...entries.keys()]).toEqual(["colab:A1:2026-08-17"]);
  });

  it("dry run writes nothing but reports would-create / would-update", async () => {
    const { db, entries } = fakeDb();
    const csv = [HEADER, row({ act: "A1", id: "1" }), row({ act: "A2", id: "2", date: "19/08/26" })].join("\n");
    const stats = await importColabProgress(db, "p1", csv, { ...opts, dryRun: true });
    expect(entries.size).toBe(0);
    expect(stats.progressEntriesCreated).toBe(2);
    expect(stats.progressEntriesUpdated).toBe(0);
  });
});
