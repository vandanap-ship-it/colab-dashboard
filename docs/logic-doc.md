# Siddhi Logic — Full Reference

Every business rule the app runs, in plain English. Use this doc when you want to know *why* a number came out the way it did.

For a quick lookup (one line per rule), see `logic-crisp.md`.

**Source of truth:** the code files listed at the end.
**Update this doc:** whenever we change how a number is calculated.

---

## Daily Scorecard

### §1 The 4 tiles at the top

Each tile is a today count vs the number that should have moved today.

**Site Progress Updated (Yes / No)**
Was anything logged today anywhere on the project? Yes or No.

**Contractors Updated**
Numerator: contractors that logged at least one progress entry today.
Denominator: contractors we expected to log today.

**Blocks Updated**
Numerator: blocks with at least one progress entry today.
Denominator: blocks with any activity planned today.

**Villas Updated**
Numerator: villas that logged today.
Denominator: villas we expected to log today.

**What "expected today" means for an activity:**

- Today falls inside its planned window (planned start ≤ today ≤ planned finish), OR
- Its planned finish already passed and it's still open (not marked complete).

**A villa counts as expected today** if it has at least one such activity.

### Abraham Thomas view

When the contractor filter is set to Abraham Thomas, the report uses a **hard-coded list of 41 villas** — the same list Shraddha's Python toolkit uses. These are V3–8, V9–11, V12–14, V15–16, V17–19, V20–22, V23–24, V25–31, V32–37, V41–43, V44–46.

The block numbers Abraham's view displays come from a lookup:
V2 shows as block 02, V3–8 as block 02, V9–11 as block 03, V12–14 as block 04, and so on up to V44–46 as block 13.

This mirrors Python exactly. The `contractor` field on individual activities is IGNORED for this view — we go by the villa number alone.

### §2 Daily Movement — per contractor

For each contractor:
- **Villas in scope** = the contractor's total villas (hard-coded: Abraham 41, Elegant 52).
- **Executed / Planned** = villas that logged today / villas we expected today.
- **Not updated** = planned − executed.

### §3 Planned Coverage by Block

For each block with any activity planned today:
- Green chip = villa logged today.
- Gold-edged chip = villa logged today but wasn't expected today (ahead of plan).
- Plain chip = we expected today, nothing logged.

### §5 Milestone Progress — per villa

Every villa has 8 milestones (Foundation → Handover). This section shows how far along each villa is on each milestone.

**Current stage** of a villa = the first milestone that isn't closed yet.

**A milestone closes when either:**

1. **The ★ END-marker rule.** If the milestone has a special "END" activity — like `Footing RCC — Concreting ★` — the milestone closes when that ★ activity finishes. Doesn't matter if other activities under it are still open.
2. **The all-baselined-children rule.** If there's no ★, the milestone closes only when every planned activity under it is done.

Whichever fires first wins.

**Milestone % complete** = weighted average of the children's % complete, weighted by their planned duration.

### §7 Project Health

- **Start / End** = earliest / latest baseline date across all milestones.
- **Actual / Projected** = actual start / projected finish where we have them, baseline otherwise.
- **Progress to date** = sum of activity weights for activities where anything has been logged.
- **Overall complete** = should be 100 % at project end.

---

## Weekly Report

### §1 Overall Progress

At the end of the week:

- **Planned %** = sum of activity weights for every activity that was SUPPOSED to be done by weekend. "What percentage of the project should be complete by now if we ran on plan."
- **Actual %** = sum of activity weights for every activity where something has been logged. "What percentage the site has actually finished by now."
- **Variance** = Actual − Planned.

**About activity weights.** Every activity has a weight — how much of the whole project it represents. All weights add up to about 100 % across the schedule. The weight comes from the Colab CSV's `Physical_Progress` column and gets loaded into Siddhi during the Colab import.

### §2 Milestone Plan (per contractor)

Villas grouped by their current milestone, split by contractor. Tells you what stage each contractor's villas are at.

### §3 Weekly Delivery (villas closed)

Villas whose final activity finished inside the reporting week.

### §4 Milestone Master

Grid: 8 milestones × all villas. Each cell shows a status — planned, achieved, delayed.

### §5 Hindrance Log

Every open hindrance, with how many days it has impacted the project and its current status.

---

## Milestone rollup — the exact rules

Two ways a milestone can close. Whichever comes first wins.

**Rule 1: ★ END-marker.** The milestone has a leaf activity flagged as a sub-milestone AND categorized as `END`. When that leaf is marked complete, the milestone closes — even if other leaves under it are still open. Used when the END activity is the "signal" the milestone is done (like the ★ Concreting Complete step).

**Rule 2: All baselined children.** No ★ exists. The milestone closes when every leaf that has a baseline is at 100 % complete. Closing date is the latest actual finish across those leaves.

If neither fires, the milestone stays open.

---

## Villa numbering (Amanvana)

95 villas total, split across two active contractors and one placeholder:

| Contractor | Villa count | Notes |
|---|---|---|
| Abraham Thomas | 41 | Hard-coded list from the Python toolkit |
| Elegant Construction | 52 | |
| "To Be Decided" | 52 | Placeholder — will be reassigned during construction |

**Villa 10 & 11 quirk.** Python treats these as a single unit `"Villa 10 & 11"`. Siddhi keeps them as two separate rows because that's how the DB is structured. Abraham's universe includes both villa numbers so the count matches Python (41 either way).

---

## Access control — who sees what

Every user has a `modules` field. Two possibilities:
- **NULL** = full access (internal White Lotus staff).
- **A list like `["QAQC"]`** = scoped access (external contractor).

**The seven modules:**

`PROGRESS`, `QAQC`, `SAFETY`, `HINDRANCE`, `CONCERN`, `RFI`, `PERMIT`

### The three gates

Every access decision is one of these three checks:

**1. Module gate — `canAccessModule(user.modules, moduleKey)`.**
Applied at every module-owning endpoint. A scoped user must have the module in their scope. Full-access users always pass.
Example: `/api/rfi` calls `canAccessModule(user.modules, "RFI")`. A user with `modules = ["QAQC"]` gets a 403.

**2. Scoped-row gate — `canAccessScopedRow(user.modules, row.module)`.**
Applied to rows that carry a `module` field (Issue, Inspection). A QAQC-scoped user can act on QAQC rows but NOT on SAFETY rows or on general (module = NULL) rows. Full-access users always pass.
Example: a QAQC contractor gets a 403 when they try to PATCH a SAFETY snag by its ID, even though snag IDs aren't secret.

**3. Page-level scope gate — `isScopedUser(user.modules)`.**
Applied to planning-side pages (all reports, gantt, timeline, snags, bills, look-ahead, add-progress, contractor-assign, insights). Any scoped user hitting the URL gets redirected to `/mobile`. This is belt-and-suspenders — the API is already gated, but the page redirect prevents a confusing empty desktop UI for a scoped user with a non-mobile role.

### Cross-project FK guard

**Rule:** every POST that accepts both a `projectId` and a `wbsNodeId` (an activity ID) checks that the activity actually belongs to that project.

**What it prevents:** a client posting `{ projectId: A, wbsNodeId: node-in-B }`. Without the guard, the row would land linked to a foreign project's activity — reports double-count, dashboards mis-attribute.

Applied on: issues, hindrances, concerns, inspections, RFIs, and bill lines.

---

## Data integrity rules

Rules that apply everywhere the app writes to the database.

| Rule | What it does | Where it's enforced |
|---|---|---|
| Soft-delete filter | Reads never return trashed rows unless the caller asks explicitly | Prisma extension in `src/lib/prisma.ts` (12 models) |
| Optimistic lock | Every PATCH refuses if the row changed since the client read it | `src/lib/optimisticLock.ts` |
| Idempotency | Mobile POSTs de-dupe on `idempotencyKey`, so a network retry doesn't create two rows | Every mobile-facing POST endpoint |
| Cross-project FK guard | Blocks cross-project activity links (above) | `src/lib/projectFkGuards.ts` |
| Audit trail | Every mutation logged with WHO, WHEN, WHAT | `src/lib/audit.ts` → `AuditLog` table |
| Timezone | Every human-readable date rendered in IST regardless of caller's local zone | `src/lib/dates.ts` |

---

## Backup + recovery

**Nightly backup.** A GitHub Action runs at 02:00 IST every day. It calls `pg_dump` against the production database, gzips the output, and uploads to the private Vercel Blob store under `backups/YYYY-MM/`.

**Verification.** Immediately after upload, `scripts/verify-backup.ts` runs. It downloads what was just uploaded, gunzips it, counts rows per table, and refuses if either:
- The compressed file is under 100 KB (catches the "empty gzip" failure we saw in August).
- Any of Project / User / WBSNode / Contractor comes back with zero rows (catches "backup ran against wrong DB").

**Alert on failure.** If the workflow fails at any point, a "🚨 Siddhi backup FAILED" email goes to Vandana + Shraddha via Resend. Immediate signal, no silent failure.

**Restore.** Two paths:
- **Fast, low blast radius:** Neon Point-in-Time Restore. Create a branch from a timestamp, point Vercel's `DATABASE_URL` at it, done. Takes ~1 minute per restore.
- **Slower, more control:** download the `.sql.gz` from Blob, gunzip, `pg_restore` against a fresh Neon branch, verify, cut over. Takes 15–30 minutes.

**Retention.** No auto-cleanup — a manual `.github/workflows/backup-cleanup.yml` exists for the "purge everything" case. Storage cost is negligible at Siddhi's scale.

---

## Roles

| Role | Sees desktop? | Sees mobile? | Can create project? | Admin? |
|---|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ | ✓ |
| PLANNER | ✓ | ✗ | ✓ | ✗ |
| PRODUCT_TEAM | ✓ | ✗ | ✗ | ✗ |
| SITE_MANAGER | ✓ | ✓ | ✗ | ✗ |
| SITE_ENGINEER | ✗ | ✓ | ✗ | ✗ |

Scoped external contractors are typically assigned SITE_ENGINEER role. Scoped users with a non-SITE_ENGINEER role are still blocked from planning-side pages by the page-level scope gate (see access control above).

---

## Files (source of truth in code)

**Report computation**
- `src/lib/scorecardServer.ts` — daily scorecard aggregation
- `src/lib/weeklyReportServer.ts` — weekly report aggregation
- `src/lib/currentStage.ts` — current stage per villa
- `src/lib/milestoneRollup.ts` — milestone closure and % complete rules
- `src/lib/istDay.ts` — IST day boundary
- `src/lib/holidays.ts` — Indian public holidays list
- `src/lib/manpower.ts` — headcount aggregation

**Colab ingest**
- `src/lib/colabSync.ts` — Colab progress CSV → Siddhi (baselines + activity weights + progress entries)
- `src/lib/colabSyncMapping.ts` — Sub_Location → milestone section, reason code mapping

**Access control + integrity**
- `src/lib/modules.ts` — module keys, `canAccessModule`, `canAccessScopedRow`, `isScopedUser`
- `src/lib/roles.ts` — role definitions, `isAdmin`, `canReview`, `canSeeDesktop`
- `src/lib/projectFkGuards.ts` — cross-project FK guards
- `src/lib/optimisticLock.ts` — `checkConflict` used by every PATCH endpoint
- `src/lib/dates.ts` — IST-pinned date formatters
- `src/lib/audit.ts` — `recordAudit` used by every mutation

**Ops**
- `scripts/verify-backup.ts` — nightly backup verifier
- `scripts/smoke-prod.ts` — post-deploy smoke test
- `src/app/api/health/route.ts` — public liveness probe

For change history on any rule, `git log` on the file above.
