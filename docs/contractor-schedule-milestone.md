# Contractor Schedule — Plan B · Milestone-Level

> Companion to [`contractor-schedule.md`](contractor-schedule.md), which is Plan A
> (activity-level, monthly Excel template). This document captures Plan B,
> designed against the real data in the Elegant + A&T master trackers Vandana
> shared on 2026-10-26. Vandana will pick between the two after the team
> discussion on 2026-10-27.

---

## 1. The problem (shared with Plan A)

Siddhi has one schedule, in-house, with buffers. Payment and delay-detection
both depend on that schedule. Contractors run on their own plans without
buffers. We need both schedules in the tool so we can tell when the buffer
has been eaten and the project is heading for slip.

Everything about **why** is identical to Plan A. What differs is **what the
contractor sends, at what granularity, and in what format**.

---

## 2. Decisions, revised for Plan B

### Primary unit = construction milestone

Both Elegant and A&T already maintain a 14-step construction milestone
list in their master trackers. 13 of 14 names are identical, the one
cosmetic mismatch (FF Columns vs First Floor Column) is handled by a
one-line alias table.

| # | Milestone |
|---|---|
| 1 | Excavation |
| 2 | PCC for Footing |
| 3 | Footing Concreting |
| 4 | Retaining Wall |
| 5 | Pedestal / Col (Plinth) |
| 6 | Plinth Beam |
| 7 | Grade Slab |
| 8 | GF Columns |
| 9 | GF Roof Slab |
| 10 | FF Columns (alias: First Floor Column) |
| 11 | FF Roof Slab |
| 12 | SF Columns |
| 13 | SF Roof Slab |
| 14 | Terrace / Head Room |

This becomes the canonical construction-milestone list in Siddhi, stored
per-project so future projects can diverge.

### Mapping to Siddhi's existing sales milestones

Siddhi's current `MilestoneSection` list is 10 payment-aligned sections,
not 14 construction stages. We **keep both**, side by side:

| Contractor milestone (14) | Rolls up to Siddhi section (10) |
|---|---|
| 1–5 Excavation → Pedestal | Foundation / Substructure |
| 6–7 Plinth Beam, Grade Slab | Plinth Level |
| 8–9 GF Columns, GF Roof Slab | Ground Floor Structure |
| 10–11 FF Columns, FF Roof Slab | First Floor Structure |
| 12–13 SF Columns, SF Roof Slab | Second Floor Structure |
| 14 Terrace / Head Room | Terrace Works |

Siddhi's Masonry / MEP / Commissioning sections stay untouched; contractors
don't track at that level anyway.

**Hybrid model** — construction milestones live in a new `ConstructionMilestone`
model, 14 rows per villa. They are **mapped many-to-one** to the existing
`MilestoneSection`. Signal is computed at the 14-row level; dashboards that
need payment granularity read the 10-row rollup. Each has one job.

### Format and ingestion

Contractors do not fill a Siddhi template. They maintain a live master
tracker (Google Sheet) with multiple tabs. We ingest CSV exports of the
relevant tabs.

- **Required tab**: *Milestone Tracker*. One file per handover, per
  contractor. Wide pivoted CSV: rows are the 14 milestones, columns are
  villas × (Planned, Actual, Delay).
- **Optional tab**: *Activity Tracker* (Elegant has it, A&T doesn't).
  Finer granularity, parsed if present, ignored otherwise.
- **Deferred tabs**: *Resource Plan* and *DLR / DPR*. Interesting data but
  not scheduling. Phase 7+.

### What's captured per milestone, per villa

- **Planned date** (contractor's committed finish date for that milestone)
- **Actual date** (when the contractor says they finished it)
- **Delay** (pre-computed by the contractor: `+2` = 2 days late, `-6` = 6
  days early). Re-derive on ingestion as a sanity check.

Siddhi's own site-logged progress stays independent. Contractor-reported
actual vs Siddhi site-logged actual is itself a signal — a divergence
means one side is lying or missing updates.

### Villa groups

A&T sometimes tracks 2–3 villas as one unit (`V30/29`, `V17/18/19`,
`V32/33`). Siddhi splits those into individual rows at ingestion with
duplicated dates. Preview UI shows the split before Vandana commits.

### Cadence

Contractors update their trackers on their own schedule. Elegant seems to
revise ad-hoc, A&T versions explicitly ("Schedule v3.0 as on 08.09.26").
Siddhi does not depend on monthly cadence; Vandana uploads whenever a
revision lands.

### Schedule versions

A&T treats the master schedule as a versioned artifact. For v1 we **store
only the latest batch per contractor**; prior versions overwrite silently.
If leadership ever asks "what did A&T originally promise in v2.0", we add
batch history later. Trade-off noted explicitly to avoid regret.

### The signal (unchanged from Plan A)

Per contractor milestone, per villa:

| Colour | Rule |
|---|---|
| 🟢 Green | Contractor planned-end + 10 days ≤ Siddhi in-house end |
| 🟠 Orange | Within 5–10 days of in-house end |
| 🔴 Red | Contractor end ≥ in-house end |
| ⚪ Blank | Contractor hasn't planned this milestone yet |

Dashboard villa colour, Scorecard, weekly report all read from this.

### Weekly digest email

Monday 08:00 IST, to Vandana only. Counts of 🟢 / 🟠 / 🔴 across the 14
milestones × active villas, grouped by contractor + Siddhi section.

---

## 3. Branch policy & safety stance (identical to Plan A)

- Branch `contractor-schedule`, no deployment to main until Phase 7 field-test
  passes.
- Vercel prod URL serves main only.
- Prod Neon DB sees no schema changes until Phase 7 merge.
- Mainline hotfixes continue landing on main; weekly merge-forward into
  this branch.
- Even after merge, new UI gated by admin-allowlist until Vandana green-lights.

---

## 4. Phased plan

| Phase | What | Status |
|---|---|---|
| 0 | Decisions + planning doc + mapping confirmed with team | Done today |
| 1 | Prisma schema: `ConstructionMilestone` + `ContractorMilestoneBatch` + per-villa mapping, additive migration | Pending plan selection |
| 2 | CSV upload page, parses Milestone Tracker tab, fuzzy-match contractor milestone names to the 14, villa label match, preview-before-commit | Pending |
| 3 | Dual-schedule rollup: `milestoneSignalForVilla`, `villaRollupBySignal` at both the 14-milestone level and the Siddhi-section rollup | Pending |
| 4 | Signal across UI: dashboard colour, Scorecard, weekly report, villa detail | Pending |
| 5 | Weekly digest cron, Monday 08:00 IST, to Vandana | Pending |
| 6 | Progress precheck gate uses contractor milestone dates | Pending |
| 7 | Variance signal: contractor-reported actual vs Siddhi site-logged actual | Pending |
| 8 | Field test on one block (A&T's Block 09 is a candidate: 7 villas, active now), 2 weeks of use, then merge to main | Pending |

Realistic calendar: 4–6 weeks of careful work. Shorter than Plan A because
granularity is coarser and the parsing is deterministic (14 known rows per
file, no fuzzy activity-name matching).

---

## 5. Still open

- **Resource Plan + DLR_DPR tabs**: valuable manpower + material data,
  deferred. Phase 7+ or beyond. Would add a reports surface, not scheduling.
- **Activity Tracker ingestion** (Elegant only): optional secondary. Could
  give the signal activity-level depth where available, milestone-level
  everywhere else. Deferred.
- **Batch history** (A&T schedule versions): v1 keeps latest only. Add
  version history if leadership asks for original-vs-revised comparisons.

---

## 6. Open invariants (same as Plan A)

- Siddhi's existing `MilestoneSection` + `VillaMilestone` + CRM-stage
  wiring never change meaning. Sales + payment flow untouched.
- Site team never sees different reality from today until Phase 7 cutover.
- Prod Neon DB sees no schema changes until merge.
- Mainline cadence continues: bug fixes land on main as usual.

---

## 7. What Plan B is better at (vs Plan A)

- **Matches the real data.** Both contractors already work in this format.
  Zero contractor-side change.
- **Smaller surface.** 14 fixed rows per villa, not 50+ activities.
  Smaller UI, smaller parser, smaller risk.
- **Signal available on day one.** Contractors have been maintaining these
  trackers for months. We get a full back-fill from the first file, not
  "wait for the first monthly handover".
- **Captures Actual, not just Planned.** The contractor-vs-Siddhi variance
  becomes a free bonus signal.

## 8. What Plan B is worse at (vs Plan A)

- **Coarser granularity.** A slip inside a milestone goes unnoticed until
  the milestone's end approaches. A single activity late by a week may not
  flip any colour.
- **Dependence on contractor diligence.** Siddhi only sees what the
  contractor cares to put in their tracker. If a contractor stops updating
  their master tracker, we get stale data silently.
- **No daily task view.** Plan A's activity-level data lets us drive a
  site-engineer "What's on today" view. Plan B does not. Site team keeps
  logging progress at Siddhi's existing activity level, independent of the
  contractor side.

---

## 9. Decision log

- 2026-10-26 — Plan B drafted after reading Elegant + A&T master trackers.
  Both contractors use the same 14-milestone framework. Format is wide
  pivoted CSV, not a Siddhi template.
- 2026-10-26 — Plan A kept intact in [`contractor-schedule.md`](contractor-schedule.md).
  Vandana will pick between them after the team review on 2026-10-27.
