# Contractor Schedule — Plan A · Activity-Level

> **One of two active plans.** Companion plan at
> [`contractor-schedule-milestone.md`](contractor-schedule-milestone.md),
> drafted 2026-10-26 against the real Elegant + A&T master trackers.
> Vandana picks between the two after the team review on 2026-10-27;
> until then both are preserved for comparison. See the "Plan A vs
> Plan B" note at the end of the milestone doc for a side-by-side.

Source of truth for the dual-schedule rework. Everything below was agreed
by Vandana between 2026-10-22 and the kickoff of this doc. The doc lives
on the `contractor-schedule` branch and is updated as decisions firm up.
If something here differs from what we actually build, the doc gets the
first fix.

---

## 1. The problem

Siddhi today has **one schedule** at the activity-item level: the
in-house schedule, which carries buffers. We are adding a **second
schedule** owned by each contractor, delivered monthly, representing
actual on-site work plans without buffers.

### Why both must live in the tool

1. **Sales milestone payment triggers on in-house dates.** Even if a
   contractor finishes early, payment doesn't fire until the in-house
   date hits. The sales side keeps watching the in-house schedule
   exactly as it does today.
2. **In-house delay is the Big Red Alert.** Contractor slip ≠ project
   slip (buffers absorb it). The moment the contractor's planned-end
   touches the in-house planned-end, the buffer is gone and the
   project is in danger. That signal is what the planner team needs
   to see first.

---

## 2. Decisions locked (Phase 0)

### Data model

- **Separate table, not sidecar columns.** New model
  `WBSContractorPlan` with one row per `(wbsNodeId, monthlyBatchId)`.
- **Monthly batches** carried via a sibling `MonthlyBatch` model so
  every monthly handover keeps its own history. Re-uploading a month
  replaces that month's batch; previous months stay intact.
- **In-house schedule continues to live on `WBSNode`.** No changes to
  existing columns, no renames, no backfills. Legacy data is treated
  as in-house, which is what it already is.

### Monthly handover mechanics

- **Who sends it**: contractor team's planner → in-house projects
  person → Vandana.
- **Who ingests**: Vandana, via an admin page on Siddhi.
- **Format**: Excel (`.xlsx`), one file per month, using the Siddhi
  template at `docs/contractor-schedule-template.xlsx`.
- **Mapping key**: Villa + Activity name. Contractors use the same
  activity *names* as Siddhi WBS, not the same codes. Siddhi fuzzy-
  matches on name and villa.
- **Partial coverage semantics**: "no contractor date for this
  activity in this month" means **the contractor has not planned it
  for this month**. Not "dropped", not "unknown" — just not in scope
  for the current window.
- **Correction**: re-upload with same month label. Preview shows a
  diff; commit replaces the previous batch for that month.

### The signal (per activity)

Driven by the gap between contractor's planned end and in-house's
planned end for the same `(wbsNodeId)`:

| Colour | Rule | Meaning |
|---|---|---|
| 🟢 Green | contractor_end + 10 days ≤ in_house_end | Comfortable buffer |
| 🟠 Orange | contractor_end is within 5–10 days of in_house_end (inclusive) | Buffer eaten, warning |
| 🔴 Red | contractor_end ≥ in_house_end | Buffer gone, in-house milestone will slip |
| ⚪ Neutral | contractor plan absent for the current month | Not comparable yet |

Thresholds (`5` for orange-start, `10` for orange-end) are per-project
settings, not hard-coded. Different project types tolerate different
buffer margins.

### Which schedule drives which surface

| Surface | Reads from |
|---|---|
| Site engineer "What's on today" | **Contractor** |
| Daily nudge / morning email | **Contractor** |
| Progress precheck gate | **Contractor** (confirmed) |
| Planner red-alert banner | **In-house** |
| Sales milestone trigger | **In-house** (unchanged) |
| Weekly report / Site Progress Scorecard | **Both** |
| Dashboard villa colour | **In-house slip** (unchanged behaviour) |

### Weekly digest email

- **Recipient**: Vandana only, for now. Others added on request.
- **Cadence**: Monday 08:00 IST.
- **Content**: counts of 🟢 / 🟠 / 🔴 activities for the month, plus a
  per-villa breakdown. Each row links to the villa detail page.
- **Delivery**: email (not push). Already-configured Resend / SMTP
  path used by `weekly-report` cron is reusable.
- **SOP posture**: Vandana handles both 🟠 and 🔴 nudges for now; loops
  in Shraddha when a red stays red for > 1 week. Codify in a separate
  SOP doc once we have a few weeks of real signal.

### Percentage-of-project tracking

Deferred to Phase 7. When built, baseline weighting defaults to
**scheduled duration** (every activity's weight = its duration in
days). Re-weight to BOQ value later if the data becomes available.
Two numbers per month:

- Contractor-promised % of total project this month.
- In-house-required % of total project by end of this month.

Plus actual % done.

### Multi-project posture

Siddhi is becoming reusable across upcoming projects, not just
Amanvana. From Phase 1 onwards:

- No project-id hardcoding anywhere in the new code.
- Signal thresholds (`5`, `10` days) stored on `Project` as columns,
  not constants.
- Weekly digest recipient list stored per-project, not hardcoded.
- Template Excel file remains project-agnostic; the activity names a
  given project uses are whatever its WBS carries.

---

## 3. Branch policy & safety stance

Primary promise: **nothing on main changes because of this work until
Phase 7 cutover is signed off**.

### Branch

- Branch name: `contractor-schedule`.
- Branched off `main` at commit `7a289b9` (`Adoption · weekly
  straggler nudge cron`).
- All contractor-schedule work lands here first.

### Vercel

- Production URL `siddhi-whitelotus.vercel.app` serves **main only**.
- The branch gets its own Vercel preview URL at
  `<auto-generated>.vercel.app`. No custom domain, no auto-promote.
- A pushed branch commit **triggers a Vercel preview deployment**;
  that preview URL is where we test the branch's state before
  bringing it to main.

### Database

- **Prod Neon DB stays untouched** by anything on this branch.
- Phase 1 (schema change) migrates against a **separate Neon
  database branch** created once, named `contractor-schedule`. Vercel
  preview env points `DATABASE_URL` at that Neon branch, prod points
  at prod as always.
- Migrations are forward-only, additive (new tables, nullable
  columns). No existing columns renamed, dropped, or re-typed. If a
  migration risks breaking existing queries, we talk about it before
  running it.
- Seed scripts for the preview DB come from a prod snapshot taken at
  branch-create time. Site team data stays on prod; the preview DB
  is for the branch's own experimentation.

### Hotfix flow

- Fixes on main are made the usual way, straight to main.
- Weekly: merge `main` → `contractor-schedule` to keep the branch
  caught up. Nothing goes the other direction until Phase 7.

### Feature-flag gate (Phase 2 onwards)

Even after merge-back to main, the new UI surfaces (contractor
schedule upload, dual-schedule reports, red-alert banner) live
behind an admin-only gate:

- Route guard: `isAdmin(session.user.role)` OR explicit allowlist of
  user ids (Vandana, Shraddha).
- Rolled out to the broader site team only when Vandana green-lights
  it.

---

## 4. Phased plan

| Phase | What | Status |
|---|---|---|
| 0 | Decisions + planning doc + sample Excel template + branch created | ✅ Locked today |
| 1 | Prisma schema: `WBSContractorPlan` + `MonthlyBatch` + per-project signal thresholds | Pending |
| 2 | Admin upload page: parse `.xlsx`, fuzzy-match, preview diff, commit | Pending |
| 3 | Dual-schedule rollup helpers: `signalForActivity`, `villaRollupBySignal` | Pending |
| 4 | Signal across the UI: dashboard villa colour, Scorecard, weekly report, villa detail | Pending |
| 5 | Weekly digest email cron, Monday 08:00 IST, to Vandana | Pending |
| 6 | Progress precheck gate switches to contractor schedule | Pending |
| 7 | Percentage-of-project tracking (duration-weighted) | Pending |
| 8 | Field test on one block, Madhavan + Harish exercise it 2 weeks, then merge to main | Pending |

Realistic calendar: 5–8 weeks of careful work. No deadline pressure.

---

## 5. Still open (parked, not blocking Phase 1)

- **Sample real schedule**: once the contractor sends their first file
  using the Siddhi template, paste or forward it here. Stress-tests
  the fuzzy name matcher before Phase 2 ships.
- **BOQ-value weighting**: if we gain cost data per activity, the
  percentage-of-project tracking in Phase 7 can switch from duration
  to value. Not needed to start.
- **SOP escalation detail**: once a few weeks of signals are logged,
  write up a dedicated SOP for who-does-what on orange + red (today
  it's Vandana for both).

---

## 6. Open invariants (if any of these break, stop and raise)

- `WBSNode` existing columns never change meaning. `plannedStart` /
  `plannedEnd` continue to mean "in-house schedule".
- Site team never sees different reality from today until Phase 7
  cutover. Preview URL is for us (Vandana + Claude) only.
- Prod Neon DB sees no schema changes until Phase 7 merge.
- Mainline cadence continues: bug fixes land on main as usual,
  nothing bottlenecks on this branch.

---

## 7. Decision log

- 2026-10-22 — Branch `contractor-schedule` created off main @7a289b9.
  Planning doc written. Sample template Excel committed to
  `docs/contractor-schedule-template.xlsx`.
- 2026-10-22 — Weekly digest recipient set to Vandana only. Others
  on request.
- 2026-10-22 — Format decision: Excel (`.xlsx`), Siddhi-provided
  template. MPP, XML, CSV ruled out.
- 2026-10-22 — Mapping key: Villa + Activity name. Fuzzy match on
  name, villa disambiguates.
- 2026-10-21 — Data model decision: separate `WBSContractorPlan` +
  `MonthlyBatch` tables, not sidecar columns on WBSNode.
- 2026-10-21 — Signal is relational (contractor_end vs in_house_end),
  not absolute. Thresholds per-project.
- 2026-10-21 — Multi-project posture adopted: no Amanvana
  hardcoding in new code.
