// One-time importer for the CollabTools progress-history CSV export.
//
// Given a raw Colab CSV, this parses each row and syncs it into Siddhi's
// WBSNode / VillaMilestone / ProgressEntry tables so the reports show real
// accumulated progress on day one — instead of Siddhi starting at 0% while
// months of Colab history sit unreflected.
//
// The importer is idempotent: every ProgressEntry it writes carries a stable
// `idempotencyKey = "colab:{Activity_ID}:{Progress_Date}"`, and every WBSNode
// / VillaMilestone update is set-based (not additive). Safe to re-run at
// any time — new Colab rows land, existing rows update in place.
//
// Match strategy per row:
//   1. Villa       — Location_Name → first int → Villa.number (projectId-scoped)
//   2. Section     — colabSyncMapping.mapColabToMspSection() → MilestoneSection.name
//   3. Activity    — best-effort fuzzy match against WBSNode.name under the
//                    matched VillaMilestone. If no clean match, we still
//                    update the VillaMilestone-level rollup (percent, dates),
//                    just no activity-level ProgressEntry gets a wbsNodeId.

import Papa from "papaparse";
import { mapColabToMspSection, mapColabReasonToCode, COLAB_MILESTONE_LABEL_TO_SECTION, resolvePairedVillaNumber } from "@/lib/colabSyncMapping";
import { syncVillaMilestoneFromChildren } from "@/lib/milestoneRollup";

// Extended Prisma client with the pg adapter doesn't line up with the vanilla
// `@prisma/client` types — same pragma the MSP importer uses. We only touch a
// handful of models so runtime shape checks would be overkill.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColabRow {
  Project_Name?: string;
  Contractor_Name?: string;
  Location_Name?: string;
  Sub_Location?: string;
  Sub_Sub_location?: string;
  Activity_Type?: string;
  Activity_Head?: string;
  Activity_Name?: string;
  Progress_Date?: string;
  System_Added_Progress_Date?: string;
  Actual_Start?: string;
  Planned_Start_Date?: string;
  Projected_Start_Date?: string;
  Planned_End_Date?: string;
  Projected_End_Date?: string;
  Actual_End_Date?: string;
  Total_Qty?: string;
  Planned_Value_Quantity?: string;
  Achieved_Qty?: string;
  Cumulative__achieved_Qty?: string;
  Productivity?: string;
  Planned_Progress_?: string; // typo in Colab CSV header
  Today_Achieved_?: string;
  Total__Progress_?: string;
  Physical_Progress?: string;
  UOM?: string;
  Rate?: string;
  Amount?: string;
  Planned_Value?: string;
  Earned_Value?: string;
  Earned_Value_Cumulative?: string;
  Remark?: string;
  Reason_for_Delay?: string;
  Image_Link?: string;
  Milestone?: string;
  Milestone_type?: string;
  Activity_ID?: string;
  daily_id?: string;          // present only in Colab's day-by-day progress log
  Progress_added_by?: string; // "Name (ColabUserId)" — daily-log variant export
  /** Set when same-day daily-log rows are merged: every Image_Link. */
  __imageLinks?: string[];
}

export interface ColabSyncStats {
  totalRows: number;
  matchedRows: number;          // matched at least to villa+section
  matchedActivityRows: number;  // matched all the way to a specific WBSNode
  unmatchedRows: number;
  placeholderRowsDropped: number; // fake schedule rows we intentionally skipped
  unmatchedSamples: Array<{
    line: number;
    villa: string;
    section: string;
    activity: string;
    reason: string;
  }>;
  villasNotFound: string[];
  /** Colab villas folded into their MSP pair, e.g. "16→15". */
  villaPairAliases: string[];
  /** Rows that left an activity's progress alone because the site team
   *  entered progress for it in Siddhi (Siddhi wins). */
  siddhiWinsRows: number;
  /** Rows handled in history-only mode (Colab's day-by-day log). */
  dailyLogRows: number;
  /** Same activity + same day rows combined into one entry. */
  sameDayMerged: number;
  sectionsUnmatched: string[];
  progressEntriesCreated: number;
  progressEntriesUpdated: number;
  photosCreated: number;
  wbsNodesUpdated: number;
  villaMilestonesUpdated: number;
  contractorsCreated: string[];
  elapsedMs: number;
}

export interface ColabSyncOptions {
  dryRun: boolean;
  createdById: string;      // user attribution for the imported ProgressEntry rows
  projectName?: string;     // "AMANVANA" — filters CSV rows to that project (optional)
  /** Contractor name (case-insensitive) to fall back to when a row's
   *  Contractor_Name column is blank. Colab exports mostly blank contractor,
   *  but Shraddha confirmed on 2026-08-28 that every historical progress
   *  entry at Amanvana is Abraham Thomas's work — so passing "Abraham Thomas"
   *  here auto-tags ~7,343 of the 7,525 rows without manual assignment. */
  defaultContractorName?: string;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Colab date format is "29-07-26" (DD-MM-YY). Return null on empty/invalid. */
function parseColabDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "-") return null;
  // Handles "29-07-26", "24/07/26", "2026-07-29 15:54:18", "29-07-2026"
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Colab's day-by-day log uses slashes ("24/07/26"); the snapshot uses dashes.
  m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{2,4})$/);
  if (m) {
    const day = +m[1];
    const mon = +m[2] - 1;
    let year = +m[3];
    if (year < 100) year = 2000 + year;
    return new Date(Date.UTC(year, mon, day));
  }
  return null;
}

/** Villa 32 → 32; "Villa 10 & 11" → 10 (primary); "Villa A" → null. */
function parseVillaNumber(loc: string | undefined | null): number | null {
  if (!loc) return null;
  const m = loc.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function toFloat(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "-") return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Detect a placeholder row Colab sometimes ships in bulk — an
 *  activity slot with no real schedule and no logs. Every distinctive
 *  field is a "not-a-real-plan" marker in isolation; requiring all of
 *  them together avoids false positives on genuine not-yet-started
 *  activities.
 *
 *  Amanvana signal set (from the 29-Sep export, Villas 47-50):
 *    - Planned_Start == Planned_End, both non-blank    (zero-duration)
 *    - Actual_Start / Actual_End_Date / Progress_Date all blank
 *    - Achieved_Qty == 0 and Cumulative__achieved_Qty == 0
 *    - Milestone / Milestone_type both blank (not a real ★ marker)
 *
 *  Genuine future activities carry Planned_End > Planned_Start;
 *  real milestones carry the Milestone column. A zero-duration row
 *  with none of those is a stub, not a plan. */
function isColabPlaceholderRow(r: ColabRow): boolean {
  const ps = (r.Planned_Start_Date ?? "").trim();
  const pe = (r.Planned_End_Date ?? "").trim();
  if (!ps || !pe || ps !== pe) return false;
  const anyActual = (
    (r.Actual_Start ?? "").trim() ||
    (r.Actual_End_Date ?? "").trim() ||
    (r.Progress_Date ?? "").trim()
  );
  if (anyActual) return false;
  const achieved = toFloat(r.Achieved_Qty) ?? 0;
  const cumulative = toFloat(r.Cumulative__achieved_Qty) ?? 0;
  if (achieved !== 0 || cumulative !== 0) return false;
  const milestone = (r.Milestone ?? "").trim();
  const milestoneType = (r.Milestone_type ?? "").trim();
  if (milestone || milestoneType) return false;
  return true;
}

/** Normalize a Colab row's activity descriptor to a fuzzy-match string. */
function colabActivityDescriptor(r: ColabRow): string {
  const parts = [
    r.Sub_Location?.trim() || "",
    r.Sub_Sub_location?.trim() && r.Sub_Sub_location.trim() !== "-" ? r.Sub_Sub_location.trim() : "",
    r.Activity_Head?.trim() || "",
    r.Activity_Name?.trim() || "",
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

/** Normalize a WBS name for fuzzy matching (lowercased, punctuation stripped). */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[★—–—-]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score how well a Colab activity descriptor matches a WBS node name.
 * Higher = better. 0 = no shared tokens.
 */
function fuzzyScore(colab: string, wbs: string): number {
  const colabTokens = new Set(normalizeName(colab).split(" ").filter((t) => t.length > 2));
  const wbsTokens = normalizeName(wbs).split(" ").filter((t) => t.length > 2);
  if (wbsTokens.length === 0) return 0;
  let hits = 0;
  for (const t of wbsTokens) if (colabTokens.has(t)) hits++;
  // Penalty for excess WBS tokens (prefer tighter match).
  return hits - (wbsTokens.length - hits) * 0.1;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function importColabProgress(
  prisma: PrismaLike,
  projectId: string,
  csvText: string,
  options: ColabSyncOptions,
): Promise<ColabSyncStats> {
  const t0 = Date.now();
  const stats: ColabSyncStats = {
    totalRows: 0,
    matchedRows: 0,
    matchedActivityRows: 0,
    unmatchedRows: 0,
    placeholderRowsDropped: 0,
    unmatchedSamples: [],
    villasNotFound: [],
    villaPairAliases: [],
    siddhiWinsRows: 0,
    dailyLogRows: 0,
    sameDayMerged: 0,
    sectionsUnmatched: [],
    progressEntriesCreated: 0,
    progressEntriesUpdated: 0,
    photosCreated: 0,
    wbsNodesUpdated: 0,
    villaMilestonesUpdated: 0,
    contractorsCreated: [],
    elapsedMs: 0,
  };

  // The day-by-day log spells two headers differently from the snapshot.
  const HEADER_ALIASES: Record<string, string> = { Actvity_Head: "Activity_Head", Milestone_Type: "Milestone_type" };
  const parsed = Papa.parse<ColabRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => HEADER_ALIASES[h.trim()] ?? h.trim(),
  });
  stats.totalRows = parsed.data.length;

  // HISTORY-ONLY mode — Colab's day-by-day progress log (has a daily_id
  // column; one row per progress update, many per activity). It replays
  // past days, so it must NOT drive an activity's current state: the
  // snapshot export already set %/actuals/baselines/ColabActivity, and
  // replaying an older day would drag them backwards. In this mode only
  // ProgressEntry rows (+ photos) are written, keyed exactly like the
  // snapshot's (colab:{Activity_ID}:{date}) so overlapping days update in
  // place. Same-activity same-day rows are separate updates in Colab
  // (e.g. +76.72 then +6.57 → cumulative 83.29) — merged into one entry:
  // achieved summed, cumulative/% maxed, remarks + photos kept.
  // Detected by daily_id, or by the absence of Physical_Progress: every
  // snapshot export carries the weight column and neither day-by-day
  // variant does (the "Progress_added_by" variant has no daily_id either).
  // Erring towards history-only is the safe direction — it never touches
  // activity state.
  const fields = parsed.meta.fields ?? [];
  const historyOnly = fields.includes("daily_id") || !fields.includes("Physical_Progress");
  let rows = parsed.data;
  if (historyOnly) {
    stats.dailyLogRows = rows.length;
    const groups = new Map<string, ColabRow[]>();
    for (const r of rows) {
      const k = `${r.Activity_ID?.trim() ?? ""}|${r.Progress_Date?.trim() ?? ""}`;
      const g = groups.get(k);
      if (g) g.push(r); else groups.set(k, [r]);
    }
    rows = [...groups.values()].map((g) => {
      if (g.length === 1) return g[0];
      stats.sameDayMerged += g.length - 1;
      const num = (v: string | undefined) => toFloat(v) ?? 0;
      const raw = (r: ColabRow, key: string) => (r as unknown as Record<string, string | undefined>)[key];
      const last = g.reduce((a, b) => (num(b.Cumulative__achieved_Qty) >= num(a.Cumulative__achieved_Qty) ? b : a));
      const merged: ColabRow = { ...last };
      merged.Achieved_Qty = String(g.reduce((n, r) => n + num(r.Achieved_Qty), 0));
      merged.Cumulative__achieved_Qty = String(Math.max(...g.map((r) => num(r.Cumulative__achieved_Qty))));
      (merged as unknown as Record<string, string>)["Total__Progress_%"] =
        String(Math.max(...g.map((r) => num(raw(r, "Total__Progress_%") ?? raw(r, "Total__Progress_")))));
      merged.Remark = [...new Set(g.map((r) => r.Remark?.trim()).filter(Boolean))].join(" | ");
      merged.__imageLinks = g.map((r) => r.Image_Link ?? "").filter((l) => l.trim());
      return merged;
    });
  }

  // Credit each entry to the Siddhi user who logged it in Colab, when the
  // export says who ("Madhavarajan Soundararajan  (WL-MadhavanS)") and that
  // name has a Siddhi account; otherwise the importing admin.
  const userIdByName = new Map<string, string>();
  if (rows.some((r) => r.Progress_added_by)) {
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    for (const u of users as Array<{ id: string; name: string }>) {
      userIdByName.set(u.name.toLowerCase().replace(/\s+/g, " ").trim(), u.id);
    }
  }
  const creatorFor = (r: ColabRow): string => {
    const who = (r.Progress_added_by ?? "").replace(/\(.*\)/, "").toLowerCase().replace(/\s+/g, " ").trim();
    return (who && userIdByName.get(who)) || options.createdById;
  };

  // Purge any placeholder ColabActivity rows that got imported before
  // this filter was in place. Structured columns tell us it's a
  // placeholder without needing to inspect rawColabRow: zero-duration
  // planned window, no actuals, no progress date. The new-row filter
  // (isColabPlaceholderRow) catches them going forward; this catches
  // the ones already sitting in the table.
  if (!options.dryRun && !historyOnly) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ColabActivity"
       WHERE "projectId" = $1
         AND "plannedStart" IS NOT NULL
         AND "plannedEnd" IS NOT NULL
         AND "plannedStart" = "plannedEnd"
         AND "actualStart" IS NULL
         AND "actualEnd" IS NULL
         AND "progressDate" IS NULL`,
      projectId,
    );
  }

  // Pre-load every lookup table upfront so the per-row hot loop never hits
  // the DB. The previous villaMilestone.findUnique per row (7,525 round-trips
  // × ~50ms) blew past Vercel's 5-min function limit on the first dry-run —
  // all of these fit in ~4 batched queries now.
  const [villas, sections, contractors, allVillaMilestones] = await Promise.all([
    prisma.villa.findMany({
      where: { projectId },
      select: { id: true, number: true, label: true, unitCount: true },
    }),
    prisma.milestoneSection.findMany({
      where: { projectId },
      select: { id: true, name: true },
    }),
    prisma.contractor.findMany({
      where: { projectId },
      select: { id: true, name: true },
    }),
    prisma.villaMilestone.findMany({
      where: { villa: { projectId } },
      select: { id: true, villaId: true, sectionId: true },
    }),
  ]);

  // Types are widened to any because PrismaLike smokes the row types.
  type VillaRow = { id: string; number: number; label: string | null; unitCount: number };
  type SectionRow = { id: string; name: string };
  type ContractorRow = { id: string; name: string };
  type VmRow = { id: string; villaId: string; sectionId: string };
  const villaByNumber = new Map<number, VillaRow>(
    (villas as VillaRow[]).map((v) => [v.number, v]),
  );
  const sectionByName = new Map<string, SectionRow>(
    (sections as SectionRow[]).map((s) => [s.name, s]),
  );
  const contractorByName = new Map<string, ContractorRow>(
    (contractors as ContractorRow[]).map((c) => [c.name.toLowerCase(), c]),
  );
  const villaMilestoneByPair = new Map<string, string>(
    (allVillaMilestones as VmRow[]).map((m) => [`${m.villaId}::${m.sectionId}`, m.id]),
  );

  // Ensure the two Amanvana contractors exist so Colab's "NA-Abraham Thomas"
  // (and future rows tagged "Elegant") land on a real contractor row.
  const ensureContractor = async (colabName: string): Promise<string | null> => {
    if (!colabName) return null;
    const cleaned = colabName.replace(/^NA-/, "").trim();
    if (!cleaned) return null;
    const hit = contractorByName.get(cleaned.toLowerCase());
    if (hit) return hit.id;
    if (options.dryRun) {
      if (!stats.contractorsCreated.includes(cleaned)) stats.contractorsCreated.push(cleaned);
      return null;
    }
    const created = await prisma.contractor.create({
      data: {
        projectId,
        name: cleaned,
        category: "Civil",
        active: true,
      },
      select: { id: true, name: true },
    });
    contractorByName.set(cleaned.toLowerCase(), created);
    stats.contractorsCreated.push(cleaned);
    return created.id;
  };

  // Siddhi wins (Shraddha, 2026-10-07): where an activity has progress the
  // site team entered in Siddhi, Colab must not overwrite it. Map each such
  // activity to the date of its first Siddhi entry: Colab rows leave its
  // %/actuals/quantity alone, and Colab entries dated on or after that day
  // are skipped (earlier Colab history still lands). Keys "colab:" and
  // "colab-progress:" mark entries written by Colab imports.
  const siddhiFirstEntry = new Map<string, Date>();
  const nativeEntries = await prisma.progressEntry.findMany({
    where: {
      projectId,
      deletedAt: null,
      status: "PUBLISHED",
      OR: [
        { idempotencyKey: null },
        { AND: [
          { NOT: { idempotencyKey: { startsWith: "colab:" } } },
          { NOT: { idempotencyKey: { startsWith: "colab-progress:" } } },
        ] },
      ],
    },
    select: { wbsNodeId: true, date: true },
  });
  for (const e of nativeEntries as Array<{ wbsNodeId: string; date: Date }>) {
    const first = siddhiFirstEntry.get(e.wbsNodeId);
    if (!first || e.date < first) siddhiFirstEntry.set(e.wbsNodeId, e.date);
  }

  // Preload the WBS-nodes-per-villa-milestone map for fast activity fuzzy match.
  // Only load leaf nodes (level 5) tied to a villaMilestone. Include isStar
  // (isSubMilestone in schema) so the fallback path can prefer the ★
  // END-marker as the canonical activity to attach unmatched Colab rows to.
  const wbsByMilestone = new Map<
    string, // villaMilestoneId
    Array<{ id: string; name: string; totalQuantity: number | null; unit: string | null; isStar: boolean }>
  >();
  const wbsBatch = 5000;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.wBSNode.findMany({
      where: {
        projectId,
        villaMilestoneId: { not: null },
      },
      select: {
        id: true,
        name: true,
        totalQuantity: true,
        unit: true,
        villaMilestoneId: true,
        isSubMilestone: true,
      },
      take: wbsBatch,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    for (const n of batch) {
      if (!n.villaMilestoneId) continue;
      const arr = wbsByMilestone.get(n.villaMilestoneId) ?? [];
      arr.push({ id: n.id, name: n.name, totalQuantity: n.totalQuantity, unit: n.unit, isStar: !!n.isSubMilestone });
      wbsByMilestone.set(n.villaMilestoneId, arr);
    }
    if (batch.length < wbsBatch) break;
    cursor = batch[batch.length - 1].id;
  }

  // Track which VillaMilestones we touched so we can rollup at the end.
  const touchedVillaMilestones = new Set<string>();
  const touchedWbsNodes = new Set<string>();
  // Per-villaMilestone Colab-CSV aggregate: min planned start, max planned
  // end, whether any row was still open (no Actual_End_Date). After the
  // per-row loop we apply the aggregate to EVERY wbsNode in the milestone
  // so the scorecard's activity-level "planned today" check reflects the
  // CSV — not the MSP baseline dates that only ~20% of wbsNodes overwrite.
  interface MilestoneAgg {
    minPlannedStart: Date | null;
    maxPlannedEnd: Date | null;
    minActualStart: Date | null;
    maxActualEnd: Date | null;
    endMarkerClose: Date | null;    // Actual_End_Date of the CSV row marked as this stage's END-marker
    endMarkerSeen: boolean;         // did we see a Milestone-column row for this stage?
    endMarkerOpen: boolean;         // an END-marker row with no Actual_End_Date (see stage close rule below)
  }
  const milestoneAgg = new Map<string, MilestoneAgg>();

  // Python-parity stage reconstruction (build_wk23.py L32-54): walk each
  // villa's rows in CSV order, accumulating into a stageBuffer. When we hit
  // a row whose CSV `Milestone` column is a MORDER label, that row IS the
  // stage's END-marker. The stage's ps = min(buffer plannedStarts),
  // pe = max(buffer plannedEnds), done = END-marker's Actual_End_Date.
  // stageAgg is keyed by the villaMilestoneId derived from the Milestone
  // label (NOT the Sub_Location mapping), so sections with clean MORDER
  // labels (Footing → Foundation, Plinth Beam → Plinth Level, etc.) get
  // stage-scoped windows that match Python's block-based aggregation.
  interface StageAgg {
    ps: Date | null;
    pe: Date | null;
    endMarkerActualEnd: Date | null;
    endMarkerSeen: boolean;
    endMarkerOpen: boolean;
    earliestProgress: Date | null;    // min Progress_Date / Actual_Start across block
  }
  // Stage close rule: one Siddhi villaMilestone can receive END-markers from
  // BOTH halves of an MSP villa pair (Colab "Villa 15" + "Villa 16" → Siddhi
  // Villa 15). The stage is closed only when every END-marker it received is
  // closed, on the latest close date. Unpaired villas have exactly one
  // END-marker per stage, so for them this is the plain Python-parity rule.
  const stageAgg = new Map<string, StageAgg>();
  // Keyed on Colab's Location_Name, not the Siddhi villa: paired halves
  // share a Siddhi villa but must not share a stage buffer.
  let lastLocation: string | null = null;
  let stageBuffer: Array<{ ps: Date | null; pe: Date | null; progress: Date | null }> = [];

  // Queue for the per-chunk bulk ColabActivity upsert.
  interface ColabActivityQueue {
    projectId: string;
    activityId: string;
    villaId: string;
    sectionId: string;
    plannedStart: Date | null;
    plannedEnd: Date | null;
    actualStart: Date | null;
    actualEnd: Date | null;
    progressDate: Date | null;
    physicalProgress: number;
    totalPct: number | null;
    plannedPct: number | null;
    reasonCode: string | null;
    reasonNote: string | null;
    // Full Colab CSV row kept verbatim so the Master Report's "Download
    // raw activity CSV (Colab format)" export can rebuild Colab's exact
    // 37-column file. Includes columns Siddhi doesn't otherwise store
    // (Sub_Location, Activity_Head, UOM, Rate, Milestone_type, …).
    rawColabRow: Record<string, string | undefined | null>;
  }
  const pendingColabActivities: ColabActivityQueue[] = [];
  // Villas that Colab had ANY progress for — used to bulk-tag every WBS node
  // under those villas to the default contractor at the end. Fixes the
  // §2 "villas in scope" undercount (was ~13 because only activity-matched
  // WBS nodes got tagged; should be all 41 for Abraham).
  const touchedVillaIds = new Set<string>();

  // ---------- Main per-row loop ----------
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Filter by project if projectName was supplied (e.g. "AMANVANA").
    if (options.projectName && r.Project_Name?.trim() !== options.projectName) continue;

    // Placeholder-row detector: Colab exports sometimes ship whole
    // villas' worth of stub rows where every activity carries the
    // same past Planned_Start = Planned_End, marks itself 100%
    // planned, and has no actuals / no progress log / no photo.
    // Amanvana's Villas 47-50 had 700 such rows in the 29-Sep export
    // — all "planned 26 Jan 2026, 100%", never touched. Left alone
    // they inflate the project's overall planned % (they count as
    // "planned 100%" against the plan denominator) and pollute the
    // ColabActivity table with rows that carry no real signal. Drop
    // them at import.
    if (isColabPlaceholderRow(r)) {
      stats.placeholderRowsDropped++;
      continue;
    }

    // ----- 1. Villa
    const villaNum = parseVillaNumber(r.Location_Name ?? "");
    if (villaNum == null) {
      recordUnmatched(stats, i + 2, r, "villa-number-unparseable");
      continue;
    }
    const siddhiVillaNum = resolvePairedVillaNumber(villaNum, villaByNumber);
    const villa = siddhiVillaNum == null ? undefined : villaByNumber.get(siddhiVillaNum);
    if (villa && siddhiVillaNum !== villaNum) {
      const alias = `${villaNum}→${siddhiVillaNum}`;
      if (!stats.villaPairAliases.includes(alias)) stats.villaPairAliases.push(alias);
    }
    if (!villa) {
      if (!stats.villasNotFound.includes(String(villaNum))) {
        stats.villasNotFound.push(String(villaNum));
      }
      recordUnmatched(stats, i + 2, r, `villa-${villaNum}-not-in-project`);
      continue;
    }

    // ----- 2. Section
    const sectionName = mapColabToMspSection(
      r.Sub_Location ?? "",
      r.Activity_Type ?? "",
      r.Activity_Head ?? "",
    );
    if (!sectionName) {
      const key = `${r.Sub_Location}|${r.Activity_Type}|${r.Activity_Head}`;
      if (!stats.sectionsUnmatched.includes(key)) stats.sectionsUnmatched.push(key);
      recordUnmatched(stats, i + 2, r, `no-mapping-for-${key}`);
      continue;
    }
    const section = sectionByName.get(sectionName);
    if (!section) {
      recordUnmatched(stats, i + 2, r, `section-${sectionName}-not-in-schedule`);
      continue;
    }

    // ----- 3. VillaMilestone (in-memory lookup — see preload above)
    const villaMilestoneId = villaMilestoneByPair.get(`${villa.id}::${section.id}`);
    if (!villaMilestoneId) {
      recordUnmatched(stats, i + 2, r, `villaMilestone-not-found-v${villaNum}-${sectionName}`);
      continue;
    }
    stats.matchedRows++;
    touchedVillaMilestones.add(villaMilestoneId);
    touchedVillaIds.add(villa.id);

    // Update per-milestone Colab aggregate — used at end of loop to overwrite
    // baselines across every wbsNode in the milestone. Parsed from the row
    // below (dates are also parsed later for the per-row update, but we need
    // them here first).
    const _plannedStart = parseColabDate(r.Planned_Start_Date);
    const _plannedEnd   = parseColabDate(r.Planned_End_Date);
    const _actualStart  = parseColabDate(r.Actual_Start);
    const _actualEnd    = parseColabDate(r.Actual_End_Date);
    const agg = milestoneAgg.get(villaMilestoneId) ?? {
      minPlannedStart: null,
      maxPlannedEnd: null,
      minActualStart: null,
      maxActualEnd: null,
      endMarkerClose: null,   // Actual_End_Date of the row that IS the stage END-marker
      endMarkerSeen: false,   // did we see a Milestone-column row for this stage yet?
      endMarkerOpen: false,
    };
    if (_plannedStart && (!agg.minPlannedStart || _plannedStart < agg.minPlannedStart)) agg.minPlannedStart = _plannedStart;
    if (_plannedEnd   && (!agg.maxPlannedEnd   || _plannedEnd   > agg.maxPlannedEnd  )) agg.maxPlannedEnd   = _plannedEnd;
    if (_actualStart  && (!agg.minActualStart  || _actualStart  < agg.minActualStart )) agg.minActualStart  = _actualStart;
    if (_actualEnd    && (!agg.maxActualEnd    || _actualEnd    > agg.maxActualEnd   )) agg.maxActualEnd    = _actualEnd;
    // Python parity (build_wk23.py L38-45): a stage is "done" only when its
    // END-marker row's own Actual_End_Date is set. The END-marker row is
    // identified by a non-empty CSV `Milestone` column. Ignore other rows
    // (Retaining Wall, PCC etc.) for closure — they can still be open while
    // the ★ marker is closed.
    const milestoneLabel = r.Milestone?.trim();
    if (milestoneLabel) {
      agg.endMarkerSeen = true;
      if (_actualEnd) {
        if (!agg.endMarkerClose || _actualEnd > agg.endMarkerClose) agg.endMarkerClose = _actualEnd;
      } else {
        agg.endMarkerOpen = true;
      }
    }
    milestoneAgg.set(villaMilestoneId, agg);

    // Python-parity stage-walker: accumulate rows into stageBuffer until we
    // hit an END-marker (Milestone column set to a MORDER label). Reset the
    // buffer when the villa changes so a new villa's rows don't get mixed
    // into the previous villa's dangling stage buffer.
    const location = (r.Location_Name ?? "").trim();
    if (location !== lastLocation) {
      lastLocation = location;
      stageBuffer = [];
    }
    const _progressDate = parseColabDate(r.Progress_Date) ?? _actualStart;
    stageBuffer.push({ ps: _plannedStart, pe: _plannedEnd, progress: _progressDate });
    if (milestoneLabel && Object.prototype.hasOwnProperty.call(COLAB_MILESTONE_LABEL_TO_SECTION, milestoneLabel)) {
      const stageSectionName = COLAB_MILESTONE_LABEL_TO_SECTION[milestoneLabel];
      const stageSection = sectionByName.get(stageSectionName);
      const stageVmId = stageSection ? villaMilestoneByPair.get(`${villa.id}::${stageSection.id}`) : undefined;
      if (stageVmId) {
        let stagePs: Date | null = null;
        let stagePe: Date | null = null;
        let stageEarliestProgress: Date | null = null;
        for (const b of stageBuffer) {
          if (b.ps && (!stagePs || b.ps < stagePs)) stagePs = b.ps;
          if (b.pe && (!stagePe || b.pe > stagePe)) stagePe = b.pe;
          if (b.progress && (!stageEarliestProgress || b.progress < stageEarliestProgress)) stageEarliestProgress = b.progress;
        }
        const existing = stageAgg.get(stageVmId) ?? { ps: null, pe: null, endMarkerActualEnd: null, endMarkerSeen: false, endMarkerOpen: false, earliestProgress: null };
        if (stagePs && (!existing.ps || stagePs < existing.ps)) existing.ps = stagePs;
        if (stagePe && (!existing.pe || stagePe > existing.pe)) existing.pe = stagePe;
        if (stageEarliestProgress && (!existing.earliestProgress || stageEarliestProgress < existing.earliestProgress)) existing.earliestProgress = stageEarliestProgress;
        if (_actualEnd) {
          if (!existing.endMarkerActualEnd || _actualEnd > existing.endMarkerActualEnd) existing.endMarkerActualEnd = _actualEnd;
        } else {
          existing.endMarkerOpen = true;
        }
        existing.endMarkerSeen = true;
        stageAgg.set(stageVmId, existing);
      }
      stageBuffer = [];
    }

    // ----- 4. Activity (best-effort). Try fuzzy match first, then fall
    //   back to the first candidate under the villaMilestone so every
    //   Colab row still gets a ProgressEntry attached (RUNBOOK §4
    //   Activity Highlights would otherwise silently drop ~80% of rows
    //   when activity naming doesn't match tokens 1:1 — e.g. Colab's
    //   "Pedastal" typo vs MSP's "Pedestal RCC — Concreting ★").
    const candidates = wbsByMilestone.get(villaMilestoneId) ?? [];
    const descriptor = colabActivityDescriptor(r);
    let bestWbs = null as (typeof candidates)[number] | null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = fuzzyScore(descriptor, c.name);
      if (score > bestScore) {
        bestScore = score;
        bestWbs = c;
      }
    }
    if (bestScore >= 1 && bestWbs) {
      stats.matchedActivityRows++;
    } else if (candidates.length > 0) {
      // Fallback — attach to the milestone's ★ END-marker if present, else
      // the first candidate. Prefer the star because reports treat it as
      // the section's canonical activity.
      bestWbs = candidates.find((c) => c.isStar) ?? candidates[0];
    } else {
      bestWbs = null;
    }

    // ----- 5. Contractor. If the row is blank, fall back to the
    //          project's default (Amanvana = Abraham Thomas per Shraddha).
    const contractorNameRaw = r.Contractor_Name?.trim() || options.defaultContractorName || "";
    const contractorId = await ensureContractor(contractorNameRaw);

    // ----- 6. Parse row fields
    const actualStart = parseColabDate(r.Actual_Start);
    const actualEnd   = parseColabDate(r.Actual_End_Date);
    const plannedStart = parseColabDate(r.Planned_Start_Date);
    const plannedEnd   = parseColabDate(r.Planned_End_Date);
    const progressAt  = parseColabDate(r.Progress_Date) ?? actualStart ?? actualEnd;
    const cumulative  = toFloat(r.Cumulative__achieved_Qty) ?? 0;
    const achieved    = toFloat(r.Achieved_Qty) ?? 0;
    const totalQty    = toFloat(r.Total_Qty);
    const pct         = toFloat(r["Total__Progress_" as keyof ColabRow] as string | undefined) ??
                        toFloat((r as unknown as Record<string, string | undefined>)["Total__Progress_%"]) ??
                        (totalQty && totalQty > 0 ? (cumulative / totalQty) * 100 : 0);
    const reasonCode  = mapColabReasonToCode(r.Reason_for_Delay ?? "");
    const reasonNote  = r.Reason_for_Delay?.trim() || null;
    const notes       = r.Remark?.trim() || null;
    const weightPct   = toFloat(r.Physical_Progress) ?? null;
    // Colab's CSV export has a bug — Image_Link comes through as
    // "None/uploads/progress_upload/PROGRESS_UPLOAD-<uuid>.jpg" when the
    // export helper failed to substitute the CDN base URL. Storing that
    // verbatim renders as a broken image (browser treats "None/..." as a
    // relative URL against Siddhi's origin → 404). Two-part fix:
    //   1. Reject any Image_Link that doesn't at least contain "/uploads/".
    //   2. Rewrite the "None/" prefix to Colab's node CDN so the image
    //      actually resolves. If Colab changes hosts we'll see 404s on
    //      the client — cleaner failure than a blank <img>.
    const COLAB_UPLOAD_BASE = "https://node.colabtools.com/";
    // Every Colab upload link is normalised onto COLAB_UPLOAD_BASE. The
    // day-by-day log exports kalpataru-api.colabtools.com links, which
    // redirect to a CDN that answers 403; the same file path on
    // node.colabtools.com loads (verified 2026-10-07). One canonical host
    // also lets the "already has this photo" check below match the same
    // file across exports.
    const toImageUrl = (link: string | undefined): string | null => {
      if (!link || !link.includes("/uploads/")) return null;
      const raw = link.trim();
      if (raw.startsWith("None/")) return COLAB_UPLOAD_BASE + raw.slice("None/".length);
      if (/^https?:\/\/[^/]*colabtools\.com\/uploads\//.test(raw)) {
        return COLAB_UPLOAD_BASE + raw.slice(raw.indexOf("/uploads/") + 1);
      }
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      // Bare "/uploads/..." — prepend the CDN base.
      return COLAB_UPLOAD_BASE + raw.replace(/^\/+/, "");
    };
    // A merged daily-log entry can carry several photos.
    const imageUrls = [...new Set((r.__imageLinks ?? [r.Image_Link]).map(toImageUrl).filter((u): u is string => !!u))];
    const imageUrl = imageUrls[0] ?? null;
    const activityId  = r.Activity_ID?.trim();

    // Queue the Colab row for bulk ColabActivity write at end of chunk —
    // avoids ~18s of sequential upsert latency inside the per-row loop that
    // was pushing chunks past the client's fetch timeout.
    //
    // Python-parity: ColabActivity.progressDate = Colab CSV Progress_Date
    // ONLY. NO fallback to Actual_Start/Actual_End. Python's Weekly §1
    // filter uses Progress_Date; falling back inflates the "actual" %
    // count by activities that started/finished without a formal progress
    // log (27 extra rows in the current Amanvana CSV — +0.10% actual).
    const progressDateOnly = parseColabDate(r.Progress_Date);
    // Colab's CSV header has a trailing "%" that Papa strips at parse
    // time in some environments but not others, so we read via the
    // Record cast to pick up whichever variant landed.
    const rawRow = r as unknown as Record<string, string | undefined>;
    const plannedPctFromCsv = toFloat(rawRow["Planned_Progress_%"] ?? rawRow["Planned_Progress_"]);
    if (!options.dryRun && activityId && weightPct != null) {
      pendingColabActivities.push({
        projectId,
        activityId,
        villaId: villa.id,
        sectionId: section.id,
        plannedStart,
        plannedEnd,
        actualStart,
        actualEnd,
        progressDate: progressDateOnly,
        physicalProgress: weightPct,
        totalPct: pct,
        plannedPct: plannedPctFromCsv,
        reasonCode: reasonCode ?? null,
        reasonNote: reasonNote ?? null,
        rawColabRow: { ...(r as Record<string, string | undefined | null>) },
      });
    }

    // ----- 7. Write (skip in dry-run)
    if (options.dryRun) {
      if (bestWbs && siddhiFirstEntry.has(bestWbs.id)) stats.siddhiWinsRows++;
      // History mode: report what the real run would write (read-only).
      if (historyOnly && bestWbs && progressAt && activityId) {
        const since = siddhiFirstEntry.get(bestWbs.id);
        if (since && progressAt.toISOString().slice(0, 10) >= since.toISOString().slice(0, 10)) continue;
        const exists = await prisma.progressEntry.findUnique({
          where: { idempotencyKey: `colab:${activityId}:${progressAt.toISOString().slice(0, 10)}` },
          select: { id: true },
        });
        if (exists) stats.progressEntriesUpdated++; else stats.progressEntriesCreated++;
      }
      continue;
    }

    // Wrap the per-row WBS update + ProgressEntry write + ProgressPhoto
    // write in a single transaction. Previously a torn state was possible
    // if the photo insert failed after ProgressEntry.create committed:
    // on retry, the entry's idempotencyKey lookup routed the flow through
    // the UPDATE branch (which skips photo attach), so the source photo
    // was silently lost. Also protected: an in-flight failure between the
    // WBSNode update and the ProgressEntry write, which used to leave
    // dashboards reading the new pct/actualFinish for a row that had no
    // supporting ProgressEntry until an admin re-ran the sync.
    // Per-row transaction cost is bounded — Prisma's interactive
    // transactions on Neon are cheap in the shared driver.
    const perRowCounters = { wbsNodesUpdated: 0, progressEntriesCreated: 0, progressEntriesUpdated: 0, photosCreated: 0, siddhiWinsRows: 0 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.$transaction(async (tx: any) => {
      // 7a. Update WBSNode if we matched one — accumulate the state.
      const siddhiSince = bestWbs ? siddhiFirstEntry.get(bestWbs.id) : undefined;
      if (historyOnly) {
        // Past days never drive the activity's current state (see above).
        if (bestWbs && siddhiSince) perRowCounters.siddhiWinsRows++;
      } else if (bestWbs && siddhiSince) {
        // Siddhi wins: keep the team's %/actuals/quantity/contractor; only
        // the Colab schedule (baselines) and weight still apply.
        await tx.wBSNode.update({
          where: { id: bestWbs.id },
          data: {
            baselineStart: plannedStart ?? undefined,
            baselineFinish: plannedEnd ?? undefined,
            weightPct: weightPct ?? undefined,
          },
        });
        perRowCounters.siddhiWinsRows++;
      } else if (bestWbs) {
        await tx.wBSNode.update({
          where: { id: bestWbs.id },
          data: {
            // Overwrite baselines from Colab CSV — the source of truth for
            // "planned today" checks. Without this, WBSNode dates stay at MSP
            // values which can differ from Colab's tracker and cause
            // day-of-report counts to disagree with the Colab-branded PDFs.
            baselineStart: plannedStart ?? undefined,
            baselineFinish: plannedEnd ?? undefined,
            actualStart: actualStart ?? undefined,
            actualFinish: actualEnd ?? undefined,
            percentComplete: Math.min(100, Math.max(0, pct)),
            weightPct: weightPct ?? undefined,
            totalQuantity: totalQty ?? bestWbs.totalQuantity ?? undefined,
            progressEntered: (achieved > 0 || cumulative > 0) ? true : undefined,
            contractorId: contractorId ?? undefined,
          },
        });
        perRowCounters.wbsNodesUpdated++;
      }

      // 7b. Upsert ProgressEntry — only when there's a real update (achieved OR
      //     completion date OR meaningful remark), and only if we matched an
      //     activity (ProgressEntry.wbsNodeId is required).
      const hasMeaningfulSignal = achieved > 0 || cumulative > 0 || actualEnd || notes || imageUrl;
      // Day-level, so a time-of-day difference can't let a same-day Colab
      // entry through.
      const siddhiHasDay = !!siddhiSince && !!progressAt &&
        progressAt.toISOString().slice(0, 10) >= siddhiSince.toISOString().slice(0, 10);
      if (bestWbs && progressAt && hasMeaningfulSignal && activityId && !siddhiHasDay) {
        const idempotencyKey = `colab:${activityId}:${progressAt.toISOString().slice(0, 10)}`;
        const existing = await tx.progressEntry.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          await tx.progressEntry.update({
            where: { id: existing.id },
            data: {
              date: progressAt,
              achievedQuantity: achieved,
              cumulativeQuantity: cumulative,
              contractorId: contractorId ?? undefined,
              notes,
              reasonCode: reasonCode ?? undefined,
              reasonNote,
            },
          });
          perRowCounters.progressEntriesUpdated++;

          // Heal broken photo URLs from a previous import (Colab's export bug
          // stored "None/uploads/..." as the URL — see comment above where
          // imageUrl is parsed). Only touches photos whose URL clearly matches
          // the broken pattern; leaves any other photos on the entry alone.
          const brokenPhotos = await tx.progressPhoto.findMany({
            where: { progressEntryId: existing.id, url: { startsWith: "None/" } },
            select: { id: true, url: true },
          });
          for (const bp of brokenPhotos) {
            const fixed = COLAB_UPLOAD_BASE + bp.url.slice("None/".length);
            await tx.progressPhoto.update({
              where: { id: bp.id },
              data: { url: fixed },
            });
          }

          // Attach any of this row's photos the entry doesn't have yet
          // (compared by URL, after the heal above, so re-runs never
          // duplicate). Covers entries created before Image_Link parsing
          // was fixed and merged daily-log entries with several photos.
          if (imageUrls.length > 0) {
            const have = new Set(
              ((await tx.progressPhoto.findMany({
                where: { progressEntryId: existing.id },
                select: { url: true },
              })) as Array<{ url: string }>).map((ph) => ph.url),
            );
            for (const url of imageUrls) {
              if (have.has(url)) continue;
              await tx.progressPhoto.create({ data: { progressEntryId: existing.id, url } });
              perRowCounters.photosCreated++;
            }
          }
        } else {
          const created = await tx.progressEntry.create({
            data: {
              projectId,
              wbsNodeId: bestWbs.id,
              date: progressAt,
              achievedQuantity: achieved,
              cumulativeQuantity: cumulative,
              contractorId: contractorId ?? undefined,
              notes,
              reasonCode: reasonCode ?? undefined,
              reasonNote,
              createdById: creatorFor(r),
              idempotencyKey,
            },
            select: { id: true },
          });
          perRowCounters.progressEntriesCreated++;

          // 7c. Attach the photo (only for freshly-created entries — updates
          //     would risk piling up duplicates otherwise).
          for (const url of imageUrls) {
            await tx.progressPhoto.create({
              data: { progressEntryId: created.id, url },
            });
            perRowCounters.photosCreated++;
          }
        }
      }
    });
    if (bestWbs) touchedWbsNodes.add(bestWbs.id);
    stats.wbsNodesUpdated += perRowCounters.wbsNodesUpdated;
    stats.siddhiWinsRows += perRowCounters.siddhiWinsRows;
    stats.progressEntriesCreated += perRowCounters.progressEntriesCreated;
    stats.progressEntriesUpdated += perRowCounters.progressEntriesUpdated;
    stats.photosCreated += perRowCounters.photosCreated;
  }

  if (!options.dryRun && !historyOnly) {
    // Wrap the five post-loop phases in a single transaction. Individual
    // per-row writes above are idempotent (idempotencyKey on ProgressEntry,
    // no-op-if-no-change on WBSNode), so a retry after a mid-loop crash is
    // safe. The post-loop phases are NOT independently idempotent — the
    // ColabActivity bulk write + milestone aggregate + rollup + close-date
    // override are one logical operation. If any of them fails halfway,
    // rolling back keeps the DB consistent with "this sync never happened
    // after the per-row loop" instead of "half the ColabActivity mirror is
    // populated and rollups reflect the partial state". Weekly Report can
    // then read a coherent snapshot at any moment.
    //
    // Timeout is generous (5 min) because full-project syncs on Amanvana
    // touch ~14k ColabActivity rows in 200-batch chunks + milestone rollups.
    await prisma.$transaction(
      async (tx: PrismaLike) => {
        await bulkWriteColabActivity(tx, pendingColabActivities);
        await applyStageAggregateBaselines(tx, stageAgg, milestoneAgg);
        await bulkTagUntaggedWbsNodes(tx, projectId, touchedVillaIds, options.defaultContractorName, contractorByName, stats);
        await rollupTouchedMilestones(tx, touchedVillaMilestones, stats);
        await overrideAuthoritativeCloseDates(tx, stageAgg, milestoneAgg);
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
  } else if (!historyOnly) {
    // Dry run: report how many milestones a real run would roll up.
    stats.villaMilestonesUpdated = touchedVillaMilestones.size;
  }

  stats.elapsedMs = Date.now() - t0;
  return stats;
}

// ---------------------------------------------------------------------------
// Phase helpers — each was inline in importColabProgress before. Extracted so
// the main function reads as a phase list, and each phase is individually
// diagnosable. Semantics unchanged from the inline versions.
// ---------------------------------------------------------------------------

interface StageAggState {
  ps: Date | null;
  pe: Date | null;
  endMarkerActualEnd: Date | null;
  endMarkerSeen: boolean;
  endMarkerOpen: boolean;
  earliestProgress: Date | null;
}
interface MilestoneAggState {
  minPlannedStart: Date | null;
  maxPlannedEnd: Date | null;
  minActualStart: Date | null;
  maxActualEnd: Date | null;
  endMarkerClose: Date | null;
  endMarkerSeen: boolean;
  endMarkerOpen: boolean;
}

/** A stage is closed only when no END-marker it received is still open —
 *  matters when both halves of an MSP villa pair feed one villaMilestone. */
function stageCloseDate(s: StageAggState): Date | null {
  return s.endMarkerOpen ? null : s.endMarkerActualEnd;
}
function milestoneCloseDate(a: MilestoneAggState): Date | null {
  return a.endMarkerOpen ? null : a.endMarkerClose;
}
interface ColabActivityQueueRow {
  projectId: string;
  activityId: string;
  villaId: string;
  sectionId: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  progressDate: Date | null;
  physicalProgress: number;
  totalPct: number | null;
  plannedPct: number | null;
  reasonCode: string | null;
  reasonNote: string | null;
  rawColabRow: Record<string, string | undefined | null>;
}
interface ContractorLookup { id: string; name: string }

/** §7a — bulk-insert the ColabActivity queue via raw INSERT..ON CONFLICT.
 *  200-row batches so a single statement stays under Postgres' 65k parameter
 *  cap. ~1s per chunk vs ~18s for per-row upsert. */
async function bulkWriteColabActivity(prisma: PrismaLike, pending: ColabActivityQueueRow[]): Promise<void> {
  if (pending.length === 0) return;
  const now = new Date();
  // 17 params per row now (added plannedPct). Still well under
  // Postgres' 65k-parameter limit at 200 rows/chunk (~3,400 params).
  for (let i = 0; i < pending.length; i += 200) {
    const batch = pending.slice(i, i + 200);
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    batch.forEach((r, j) => {
      const base = j * 17;
      rowsSql.push(
        `(gen_random_uuid()::text, $${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14}, $${base+15}, $${base+16}::jsonb, $${base+17})`
      );
      values.push(
        r.projectId, r.activityId, r.villaId, r.sectionId,
        r.plannedStart, r.plannedEnd, r.actualStart, r.actualEnd, r.progressDate,
        r.physicalProgress, r.totalPct, r.reasonCode, r.reasonNote, now, now,
        JSON.stringify(r.rawColabRow),
        r.plannedPct,
      );
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ColabActivity" (
         "id","projectId","activityId","villaId","sectionId",
         "plannedStart","plannedEnd","actualStart","actualEnd","progressDate",
         "physicalProgress","totalPct","reasonCode","reasonNote","createdAt","updatedAt","rawColabRow","plannedPct"
       ) VALUES ${rowsSql.join(",")}
       ON CONFLICT ("projectId","activityId") DO UPDATE SET
         "villaId"          = EXCLUDED."villaId",
         "sectionId"        = EXCLUDED."sectionId",
         "plannedStart"     = EXCLUDED."plannedStart",
         "plannedEnd"       = EXCLUDED."plannedEnd",
         "actualStart"      = EXCLUDED."actualStart",
         "actualEnd"        = EXCLUDED."actualEnd",
         "progressDate"     = EXCLUDED."progressDate",
         "physicalProgress" = EXCLUDED."physicalProgress",
         "totalPct"         = EXCLUDED."totalPct",
         "plannedPct"       = EXCLUDED."plannedPct",
         "reasonCode"       = EXCLUDED."reasonCode",
         "reasonNote"       = EXCLUDED."reasonNote",
         "updatedAt"        = EXCLUDED."updatedAt",
         "rawColabRow"      = EXCLUDED."rawColabRow"`,
      ...values,
    );
  }
}

/** §7b — apply Python-parity stage baselines to every VillaMilestone + child
 *  wbsNode. stageAgg (row-order + Milestone-column boundaries) wins where
 *  present; milestoneAgg (Sub_Location grouping) fills in the gaps for
 *  sections without a MORDER row. */
async function applyStageAggregateBaselines(
  prisma: PrismaLike,
  stageAgg: Map<string, StageAggState>,
  milestoneAgg: Map<string, MilestoneAggState>,
): Promise<void> {
  for (const [vmId, sagg] of stageAgg) {
    if (!sagg.ps && !sagg.pe && !sagg.earliestProgress) continue;
    await prisma.villaMilestone.update({
      where: { id: vmId },
      data: {
        baselineStart: sagg.ps ?? undefined,
        baselineFinish: sagg.pe ?? undefined,
        actualStart: sagg.earliestProgress ?? undefined,
      },
    });
    await prisma.wBSNode.updateMany({
      where: { villaMilestoneId: vmId },
      data: {
        baselineStart: sagg.ps ?? undefined,
        baselineFinish: sagg.pe ?? undefined,
      },
    });
  }
  for (const [vmId, agg] of milestoneAgg) {
    if (stageAgg.has(vmId)) continue;
    if (!agg.minPlannedStart && !agg.maxPlannedEnd) continue;
    await prisma.wBSNode.updateMany({
      where: { villaMilestoneId: vmId },
      data: {
        baselineStart: agg.minPlannedStart ?? undefined,
        baselineFinish: agg.maxPlannedEnd ?? undefined,
      },
    });
    if (agg.endMarkerSeen) {
      await prisma.villaMilestone.update({
        where: { id: vmId },
        data: { actualFinish: milestoneCloseDate(agg) },
      });
      const star = await prisma.wBSNode.findFirst({
        where: { villaMilestoneId: vmId, isSubMilestone: true },
        select: { id: true },
      }) ?? await prisma.wBSNode.findFirst({
        where: { villaMilestoneId: vmId },
        select: { id: true },
      });
      if (star) {
        await prisma.wBSNode.update({
          where: { id: star.id },
          data: { actualFinish: milestoneCloseDate(agg) },
        });
      }
    }
  }
}

/** §8 — stamp the default contractor on every wbsNode under a touched villa
 *  that doesn't already have a contractor. Fixes the §2 "villas in scope"
 *  undercount from earlier when only ~20% of activity-matched nodes got
 *  tagged. */
async function bulkTagUntaggedWbsNodes(
  prisma: PrismaLike,
  projectId: string,
  touchedVillaIds: Set<string>,
  defaultContractorName: string | undefined,
  contractorByName: Map<string, ContractorLookup>,
  stats: ColabSyncStats,
): Promise<void> {
  if (!defaultContractorName || touchedVillaIds.size === 0) return;
  const cleaned = defaultContractorName.replace(/^NA-/, "").trim();
  const contractor = contractorByName.get(cleaned.toLowerCase());
  if (!contractor) return;
  const result = await prisma.wBSNode.updateMany({
    where: {
      projectId,
      villaId: { in: [...touchedVillaIds] },
      contractorId: null,
    },
    data: { contractorId: contractor.id },
  });
  stats.wbsNodesUpdated += result.count ?? 0;
}

/** §9 — recompute VillaMilestone.pctComplete + actualStart/Finish from
 *  child wbsNodes for every villaMilestone we touched. */
async function rollupTouchedMilestones(
  prisma: PrismaLike,
  touchedIds: Set<string>,
  stats: ColabSyncStats,
): Promise<void> {
  for (const villaMilestoneId of touchedIds) {
    try {
      await syncVillaMilestoneFromChildren(prisma, villaMilestoneId);
      stats.villaMilestonesUpdated++;
    } catch (err) {
      console.error(`[colab-sync] rollup failed for ${villaMilestoneId}:`, err);
    }
  }
}

/** §10 — Colab-authoritative override. The rollup at §9 recomputes
 *  actualFinish/actualStart from wbsNode children; that can clear the
 *  Colab END-marker close we set in §7b. This pass re-applies the
 *  authoritative values AFTER the rollup so weekly §2 buckets + the
 *  currentStage picker read Python-parity data. */
async function overrideAuthoritativeCloseDates(
  prisma: PrismaLike,
  stageAgg: Map<string, StageAggState>,
  milestoneAgg: Map<string, MilestoneAggState>,
): Promise<void> {
  const seen = new Set<string>();
  for (const [vmId, sagg] of stageAgg) {
    if (!sagg.endMarkerSeen) continue;
    seen.add(vmId);
    await prisma.villaMilestone.update({
      where: { id: vmId },
      data: {
        actualFinish: stageCloseDate(sagg),
        actualStart: sagg.earliestProgress ?? undefined,
      },
    });
  }
  for (const [vmId, agg] of milestoneAgg) {
    if (seen.has(vmId) || !agg.endMarkerSeen) continue;
    await prisma.villaMilestone.update({
      where: { id: vmId },
      data: { actualFinish: milestoneCloseDate(agg) },
    });
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function recordUnmatched(
  stats: ColabSyncStats,
  line: number,
  r: ColabRow,
  reason: string,
) {
  stats.unmatchedRows++;
  if (stats.unmatchedSamples.length < 20) {
    stats.unmatchedSamples.push({
      line,
      villa: r.Location_Name ?? "",
      section: r.Sub_Location ?? "",
      activity: [r.Activity_Type, r.Activity_Head, r.Activity_Name].filter(Boolean).join(" | "),
      reason,
    });
  }
}
