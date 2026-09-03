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
import { mapColabToMspSection, mapColabReasonToCode, COLAB_MILESTONE_LABEL_TO_SECTION } from "@/lib/colabSyncMapping";
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
}

export interface ColabSyncStats {
  totalRows: number;
  matchedRows: number;          // matched at least to villa+section
  matchedActivityRows: number;  // matched all the way to a specific WBSNode
  unmatchedRows: number;
  unmatchedSamples: Array<{
    line: number;
    villa: string;
    section: string;
    activity: string;
    reason: string;
  }>;
  villasNotFound: string[];
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
  // Handles "29-07-26", "2026-07-29 15:54:18", "29-07-2026"
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{2})-(\d{2})-(\d{2,4})$/);
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
    unmatchedSamples: [],
    villasNotFound: [],
    sectionsUnmatched: [],
    progressEntriesCreated: 0,
    progressEntriesUpdated: 0,
    photosCreated: 0,
    wbsNodesUpdated: 0,
    villaMilestonesUpdated: 0,
    contractorsCreated: [],
    elapsedMs: 0,
  };

  const parsed = Papa.parse<ColabRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = parsed.data;
  stats.totalRows = rows.length;

  // Pre-load every lookup table upfront so the per-row hot loop never hits
  // the DB. The previous villaMilestone.findUnique per row (7,525 round-trips
  // × ~50ms) blew past Vercel's 5-min function limit on the first dry-run —
  // all of these fit in ~4 batched queries now.
  const [villas, sections, contractors, allVillaMilestones] = await Promise.all([
    prisma.villa.findMany({
      where: { projectId },
      select: { id: true, number: true, label: true },
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
  type VillaRow = { id: string; number: number; label: string | null };
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
    earliestProgress: Date | null;    // min Progress_Date / Actual_Start across block
  }
  const stageAgg = new Map<string, StageAgg>();
  let lastVillaId: string | null = null;
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
    reasonCode: string | null;
    reasonNote: string | null;
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

    // ----- 1. Villa
    const villaNum = parseVillaNumber(r.Location_Name ?? "");
    if (villaNum == null) {
      recordUnmatched(stats, i + 2, r, "villa-number-unparseable");
      continue;
    }
    const villa = villaByNumber.get(villaNum);
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
      }
    }
    milestoneAgg.set(villaMilestoneId, agg);

    // Python-parity stage-walker: accumulate rows into stageBuffer until we
    // hit an END-marker (Milestone column set to a MORDER label). Reset the
    // buffer when the villa changes so a new villa's rows don't get mixed
    // into the previous villa's dangling stage buffer.
    if (villa.id !== lastVillaId) {
      lastVillaId = villa.id;
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
        const existing = stageAgg.get(stageVmId) ?? { ps: null, pe: null, endMarkerActualEnd: null, endMarkerSeen: false, earliestProgress: null };
        if (stagePs && (!existing.ps || stagePs < existing.ps)) existing.ps = stagePs;
        if (stagePe && (!existing.pe || stagePe > existing.pe)) existing.pe = stagePe;
        if (stageEarliestProgress && (!existing.earliestProgress || stageEarliestProgress < existing.earliestProgress)) existing.earliestProgress = stageEarliestProgress;
        existing.endMarkerActualEnd = _actualEnd ?? existing.endMarkerActualEnd;
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
    const imageUrl    = r.Image_Link && r.Image_Link.includes("/uploads/") ? r.Image_Link.trim() : null;
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
        reasonCode: reasonCode ?? null,
        reasonNote: reasonNote ?? null,
      });
    }

    // ----- 7. Write (skip in dry-run)
    if (options.dryRun) continue;

    // 7a. Update WBSNode if we matched one — accumulate the state.
    if (bestWbs) {
      touchedWbsNodes.add(bestWbs.id);
      await prisma.wBSNode.update({
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
      stats.wbsNodesUpdated++;
    }

    // 7b. Upsert ProgressEntry — only when there's a real update (achieved OR
    //     completion date OR meaningful remark), and only if we matched an
    //     activity (ProgressEntry.wbsNodeId is required).
    const hasMeaningfulSignal = achieved > 0 || cumulative > 0 || actualEnd || notes || imageUrl;
    if (bestWbs && progressAt && hasMeaningfulSignal && activityId) {
      const idempotencyKey = `colab:${activityId}:${progressAt.toISOString().slice(0, 10)}`;
      const existing = await prisma.progressEntry.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        await prisma.progressEntry.update({
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
        stats.progressEntriesUpdated++;
      } else {
        const created = await prisma.progressEntry.create({
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
            createdById: options.createdById,
            idempotencyKey,
          },
          select: { id: true },
        });
        stats.progressEntriesCreated++;

        // 7c. Attach the photo (only for freshly-created entries — updates
        //     would risk piling up duplicates otherwise).
        if (imageUrl) {
          await prisma.progressPhoto.create({
            data: { progressEntryId: created.id, url: imageUrl },
          });
          stats.photosCreated++;
        }
      }
    }
  }

  if (!options.dryRun) {
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
  } else {
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
  earliestProgress: Date | null;
}
interface MilestoneAggState {
  minPlannedStart: Date | null;
  maxPlannedEnd: Date | null;
  minActualStart: Date | null;
  maxActualEnd: Date | null;
  endMarkerClose: Date | null;
  endMarkerSeen: boolean;
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
  reasonCode: string | null;
  reasonNote: string | null;
}
interface ContractorLookup { id: string; name: string }

/** §7a — bulk-insert the ColabActivity queue via raw INSERT..ON CONFLICT.
 *  200-row batches so a single statement stays under Postgres' 65k parameter
 *  cap. ~1s per chunk vs ~18s for per-row upsert. */
async function bulkWriteColabActivity(prisma: PrismaLike, pending: ColabActivityQueueRow[]): Promise<void> {
  if (pending.length === 0) return;
  const now = new Date();
  for (let i = 0; i < pending.length; i += 200) {
    const batch = pending.slice(i, i + 200);
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    batch.forEach((r, j) => {
      const base = j * 15;
      rowsSql.push(
        `(gen_random_uuid()::text, $${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14}, $${base+15})`
      );
      values.push(
        r.projectId, r.activityId, r.villaId, r.sectionId,
        r.plannedStart, r.plannedEnd, r.actualStart, r.actualEnd, r.progressDate,
        r.physicalProgress, r.totalPct, r.reasonCode, r.reasonNote, now, now,
      );
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ColabActivity" (
         "id","projectId","activityId","villaId","sectionId",
         "plannedStart","plannedEnd","actualStart","actualEnd","progressDate",
         "physicalProgress","totalPct","reasonCode","reasonNote","createdAt","updatedAt"
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
         "reasonCode"       = EXCLUDED."reasonCode",
         "reasonNote"       = EXCLUDED."reasonNote",
         "updatedAt"        = EXCLUDED."updatedAt"`,
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
        data: { actualFinish: agg.endMarkerClose ?? null },
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
          data: { actualFinish: agg.endMarkerClose ?? null },
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
        actualFinish: sagg.endMarkerActualEnd ?? null,
        actualStart: sagg.earliestProgress ?? undefined,
      },
    });
  }
  for (const [vmId, agg] of milestoneAgg) {
    if (seen.has(vmId) || !agg.endMarkerSeen) continue;
    await prisma.villaMilestone.update({
      where: { id: vmId },
      data: { actualFinish: agg.endMarkerClose ?? null },
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
