# Siddhi Logic Document

Every computed number in the two reports, in plain language, with the exact rule.

**Source of truth:** the code files listed at the end.
**When to update this doc:** any time we change a computation.

---

## Daily Scorecard

### §1 Daily Site Snapshot — the 4 tiles

**SITE PROGRESS UPDATED (Yes / No)** — was at least one progress entry logged anywhere today.

**CONTRACTORS UPDATED** — number of distinct contractors that had at least one progress entry logged today. Denominator = number of contractors that were expected to move today (i.e. had at least one activity in its planned window OR overdue-open).

**BLOCKS UPDATED** — number of distinct physical blocks that had at least one progress entry today. Denominator = blocks that had any activity planned for today.

**VILLAS UPDATED** — number of distinct villas that logged progress today. Denominator = villas that were expected to move today.

An activity counts as **"planned today"** if:
- today falls inside its planned window (`baselineStart ≤ today ≤ baselineFinish`), **OR**
- its planned finish has already passed and it's still open (`baselineFinish < today AND actualFinish is null`).

A villa counts as **"planned today"** if it has at least one such activity.

### Abraham-only view

When the contractor filter is set to Abraham Thomas, the "Abraham villas" universe is the **41 hardcoded villas** matching Shraddha's `BLOCKS` map in her Python toolkit (V3–8, V9–11, V12–14, V15–16, V17–19, V20–22, V23–24, V25–31, V32–37, V41–43, V44–46). This mirrors Python exactly and is independent of wbsNode contractor tagging.

Block-wise display for Abraham view uses the Colab convention:
`{2:02, 3-8→02, 9-11→03, 12-14→04, 15-16→05, 17-19→06, 20-22→07, 23-24→08, 25-31→09, 32-37→10, 41-43→12, 44-46→13}`

### §2 Daily Movement — Contractor-wise

Per contractor:
- **Villas in scope** = the contractor's total villa count (hardcoded: Abraham 41, Elegant 52).
- **Executed / Planned** = villas that logged progress today / villas that were expected today.
- **Not updated** = planned − executed.

### §3 Planned Coverage by Block

For each block with any activity planned today:
- Chip is green if that villa logged progress today.
- Chip is gold-edged if it logged today but wasn't expected today ("ahead of plan").
- Plain chip = expected today, didn't log.

### §5 Milestone Progress — per villa

The **current stage** of each villa is the first (by section orderIndex) milestone that isn't closed (`actualFinish is null`).

A milestone closes when:
- If it has a ★ END-marker child (like "Footing RCC — Concreting ★"), the milestone closes when the ★ closes — even if other children are still open.
- If no ★ exists, the milestone closes when every baselined child is done.

Milestone pctComplete = duration-weighted avg of children's pctComplete.

### §7 Project Health

- **Start / End date** = min / max of all baselined milestones.
- **Actual / Projected** = actualStart / projectedFinish where set, otherwise the baseline.
- **Progress to date** = sum of `wbsNode.weightPct` for wbsNodes with any ProgressEntry logged as of today.
- **Overall complete** = should be 100 % at project end.

---

## Weekly Report

### §1 Overall Progress

At end of week:
- **Planned %** = sum of `wbsNode.weightPct` for every activity whose `baselineFinish ≤ weekEnd`. This is "what % of the project should be done by now if we ran on plan".
- **Actual %** = sum of `wbsNode.weightPct` for every activity that has any ProgressEntry logged by weekEnd. This is "what % of the project has been logged as done by now".
- **Variance** = Actual − Planned.

`weightPct` is the Colab CSV `Physical_Progress` column — per-activity weight, summing to ~100 % across the whole schedule. Loaded into Siddhi via the Colab progress import.

### §2 Milestone Plan (per contractor)

Uses **current stage per villa** — each villa contributes at most one milestone to the buckets. Mirrors Shraddha's Python (`build_wk23.py`).

**To Complete this week** (planned to finish this week):
- Current stage where `weekStart ≤ baselineFinish ≤ weekEnd`, still open.
- `closed` count = same window, actualFinish set (finished on time).
- `spill` = current stage with `baselineFinish < weekStart` AND still open (should've finished before this week).

**To Start this week** (planned to start this week):
- Current stage where `weekStart ≤ baselineStart ≤ weekEnd`, still open.
- `started` count = same, actualStart set (kicked off).

**In Progress this week** (span overlaps the week):
- Current stage where `baselineStart ≤ weekEnd AND baselineFinish ≥ weekStart` AND not done.
- `moving` = has actualStart set (activity is under way).
- `stalled` = span overlaps but no actualStart — should be in progress but hasn't started.

**Overdue** — same as "To Complete spill" (kept as a separate section in the UI for emphasis).

### §3 Stalled aging bar

An in-progress milestone that hasn't logged anything in N days becomes "stalled". The panel shows how long each has been idle.

### §4 Manpower

- Weekly target = sum of tradePlans across the 7 days.
- Weekly achieved = sum of ManpowerEntry.actualCount across the 7 days.
- % of plan = achieved / target × 100.
- Best day = the single day with the highest achieved headcount.
- Holidays are excluded from both numerator and denominator.

### §5 Delay Reasons

Each delay reason mentioned on:
- Any Hindrance opened this week or open going into the week, OR
- Any ProgressEntry.reasonCode logged this week

is bucketed by reason label. For each bucket:
- **# activities** = number of distinct wbsNodes that carried this reason
- **# villas** = number of distinct villas affected
- **avg / worst delay** = days past baseline finish, averaged and max
- **mitigation** = house-rules text mapped per reason code

---

## Shared logic

### IST day boundary

All "today" comparisons anchor to IST (`Asia/Kolkata`). A day starts 00:00 IST and ends 23:59:59 IST. Ensures a photo logged at 11:55 PM in Bangalore appears on that day's scorecard, not tomorrow's.

### Holidays

The `INDIA_HOLIDAYS` list (2026–2027) excludes 11 + 10 dates. Used by:
- Manpower denominator (holidays don't count against plan).
- Any "expected today" computation that's near a holiday.

### Contractor scope

- Abraham Thomas: 41 villas (per Shraddha's authoritative allocation).
- Elegant Construction: 52 villas.
- "To Be Decided": 52 villas (placeholder — a shift-elsewhere allocation).

### Villa 10 & 11 grouped pair

In the Python model, Villa 10 and Villa 11 are treated as a single unit `"Villa 10 & 11"`. In Siddhi they are separate Villa rows. The scorecard's Abraham universe includes both numbers so parity holds.

---

## Files (source of truth in code)

- `src/lib/scorecardServer.ts` — daily scorecard aggregation
- `src/lib/weeklyReportServer.ts` — weekly report aggregation
- `src/lib/currentStage.ts` — current stage per villa
- `src/lib/milestoneRollup.ts` — milestone closure and pctComplete rules
- `src/lib/istDay.ts` — IST day boundary
- `src/lib/holidays.ts` — INDIA_HOLIDAYS list
- `src/lib/colabSync.ts` — Colab CSV → Siddhi ingest (baselines + weightPct + progress entries)
- `src/lib/colabSyncMapping.ts` — Sub_Location → MilestoneSection, reason code mapping
- `src/lib/manpower.ts` — headcount aggregation

For a rules diff, read the git log on those files.
