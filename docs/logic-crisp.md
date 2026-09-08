# Siddhi Logic — Quick Reference

Every rule the app runs, one line each. Skim in 5 minutes.

For the *why* behind each rule, see `logic-doc.md`.

---

## Daily Scorecard

### The 4 tiles

| Tile | Numerator | Denominator |
|---|---|---|
| Site Progress Updated | Anything logged today? | Yes / No |
| Contractors Updated | Contractors that logged today | Contractors expected today |
| Blocks Updated | Blocks with any entry today | Blocks with anything planned today |
| Villas Updated | Villas that logged today | Villas expected today |

**Expected today** = planned start ≤ today ≤ planned finish, OR planned finish passed AND still open.

### Abraham Thomas view

- Uses hard-coded **41 villas** (V3–46, matching Python).
- Villa `contractor` field IGNORED — goes by villa number.

### Section rules (one line each)

| Section | Rule |
|---|---|
| §2 Daily Movement per contractor | Villas that logged today / villas expected today |
| §3 Planned Coverage by Block | Green = logged. Gold = ahead. Plain = expected, no log. |
| §5 Milestone Progress | Current stage = first milestone not yet closed. |
| §7 Project Health | Delay days, hindrances, activities behind |

---

## Weekly Report

| Section | Rule |
|---|---|
| §1 Overall Progress | Planned % vs Actual %, weighted by activity weight. Variance = Actual − Planned |
| §2 Milestone Plan per contractor | Villas grouped by current milestone, split by contractor |
| §3 Weekly Delivery | Villas whose final activity finished this week |
| §4 Milestone Master | Grid of 8 milestones × all villas, status per cell |
| §5 Hindrance Log | Open hindrances, days impacted, status |

**Activity weight** = each activity's share of the project (all activities sum to ~100 %). Comes from the Colab CSV's `Physical_Progress` column.

---

## Milestone rollup

Either rule closes a milestone. Whichever fires first wins.

| Rule | Trigger |
|---|---|
| ★ END-marker | The milestone has a ★ END activity → milestone closes when that activity finishes |
| All baselined children | No ★ exists → milestone closes when every planned activity is 100 % |

Milestone % complete = duration-weighted average of children's % complete.

---

## Current stage (per villa)

First milestone (by order) that isn't closed.

- Excavation closed, Superstructure open → current stage = Excavation
- Nothing closed → "Not Started"

---

## Villa numbering (Amanvana)

95 total villas.

| Contractor | Villas |
|---|---|
| Abraham Thomas | 41 |
| Elegant Construction | 52 |
| "To Be Decided" | 52 (placeholder) |

Villa 10 & 11 quirk: Python treats as one, Siddhi keeps two separate. Abraham universe counts both = 41 either way.

---

## Access control

Every user is either:

- **Full access** — `modules = NULL` (internal White Lotus staff)
- **Scoped** — `modules = ["QAQC"]` etc. (external contractor)

### The seven modules

`PROGRESS` · `QAQC` · `SAFETY` · `HINDRANCE` · `CONCERN` · `RFI` · `PERMIT`

### The three gates

| Gate | Applied on | What it does |
|---|---|---|
| **canAccessModule** | Every module endpoint (`/api/rfi` etc.) | Scoped user must have the module in scope; full access always passes |
| **canAccessScopedRow** | Rows with a `module` field (Issue, Inspection) | QAQC user can act on QAQC rows, NOT on SAFETY or general rows |
| **isScopedUser** | Planning-side pages (reports, gantt, snags, bills, etc.) | Scoped user gets redirected to `/mobile` |

### Cross-project FK guard

Any POST that takes `projectId` + `wbsNodeId` must have the wbsNodeId belong to that project. Applies on issues, hindrances, concerns, inspections, RFI, bill lines.

---

## Data integrity

| Rule | Where enforced |
|---|---|
| Soft-delete filter — reads never return trashed rows | Prisma extension (12 models) |
| Optimistic lock — PATCH refuses if row changed since read | `src/lib/optimisticLock.ts` |
| Idempotency — mobile POSTs de-dupe on retry | Every mobile POST |
| Cross-project FK guard | `src/lib/projectFkGuards.ts` |
| Audit trail — every mutation logged WHO/WHEN/WHAT | `AuditLog` table |
| Timezone — every date rendered in IST | `src/lib/dates.ts` |

---

## Backup + recovery

| Piece | Where / how |
|---|---|
| Nightly backup | GitHub Action, 02:00 IST → private Vercel Blob |
| Verifier | Same workflow, after upload — fails if backup < 100 KB or Project/User/WBSNode/Contractor is empty |
| Alert on failure | Loud email to Vandana + Shraddha via Resend |
| Restore (fast) | Neon Point-in-Time — new branch from timestamp, flip Vercel `DATABASE_URL`, ~1 minute |
| Restore (slower) | Download `.sql.gz`, `pg_restore` to fresh branch, cut over, 15–30 minutes |
| Retention | Manual — cost is negligible at Siddhi's scale |

---

## Roles

| Role | Desktop | Mobile | Create project | Admin |
|---|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ | ✓ |
| PLANNER | ✓ | ✗ | ✓ | ✗ |
| PRODUCT_TEAM | ✓ | ✗ | ✗ | ✗ |
| SITE_MANAGER | ✓ | ✓ | ✗ | ✗ |
| SITE_ENGINEER | ✗ | ✓ | ✗ | ✗ |

---

## Ops endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Public liveness — returns 200 + DB latency, 503 on DB fail |
| `GET /api/admin/migrate` | List all migrations, applied vs pending |
| `GET /api/admin/migrate?showSql=true` | Preview SQL for pending migrations |
| `POST /api/admin/migrate?dryRun=true` | Report what WOULD run, without running |
| `POST /api/admin/migrate` | Apply pending migrations |
| `POST /api/admin/clear-test-data` | Wipe test data (needs `ALLOW_DATA_WIPE=yes` env + body `{ confirm: "CLEAR_TEST_DATA" }`) |
| `POST /api/admin/restore` | Restore a soft-deleted row |

---

## Files

**Report computation:**
`scorecardServer.ts` · `weeklyReportServer.ts` · `currentStage.ts` · `milestoneRollup.ts` · `istDay.ts` · `holidays.ts` · `manpower.ts`

**Colab ingest:**
`colabSync.ts` · `colabSyncMapping.ts`

**Access + integrity:**
`modules.ts` · `roles.ts` · `projectFkGuards.ts` · `optimisticLock.ts` · `dates.ts` · `audit.ts`

**Ops:**
`scripts/verify-backup.ts` · `scripts/smoke-prod.ts` · `src/app/api/health/route.ts`

All under `src/lib/` unless noted. `git log` on any file for the change history.
