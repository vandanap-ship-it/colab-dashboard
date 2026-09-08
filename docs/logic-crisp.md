# Siddhi Logic — Crisp Reference

Every business rule in the app, one line each. Skim in 5 minutes.

For the full explanation of any rule, see `logic-doc.md`.

---

## Daily Scorecard

### The 4 tiles (top of the report)

| Tile | What it counts | Denominator |
|---|---|---|
| **Site Progress Updated** | At least one progress entry logged today | Yes / No |
| **Contractors Updated** | Distinct contractors that logged progress today | Contractors expected to move today |
| **Blocks Updated** | Distinct blocks with a progress entry today | Blocks with any activity planned today |
| **Villas Updated** | Distinct villas with progress today | Villas expected to move today |

**"Planned today"** = today is inside the planned window `[baselineStart, baselineFinish]` OR baseline has passed and activity is still open.

### Abraham-only view

Contractor filter = Abraham Thomas → uses the **41 hardcoded villas** from the Python `BLOCKS` map. Independent of contractor tagging in the DB.

### Section rules (quick)

| Section | Rule |
|---|---|
| §2 Daily Movement per contractor | Total qty added today, grouped by contractor |
| §3 Planned Coverage by Block | Villas planned today / total villas per block |
| §5 Milestone Progress per villa | % complete per villa milestone using rollup rule below |
| §7 Project Health | Overall delay days, hindrances open, activities behind schedule |

---

## Weekly Report

### §1 Overall Progress

**Achieved %** = weighted avg of `percentComplete` across all leaf activities, weighted by `weightPct`.
**Planned %** = weighted avg of what SHOULD be complete by today given baseline dates, same weight.

### §2 Milestone Plan (per contractor)

Villas grouped by their current milestone stage, split by contractor.

### §3 Weekly Delivery (villas closed)

Villas whose `actualFinish` fell inside the reporting week.

### §4 Milestone Master

All 8 milestones × all villas → status per cell (planned / achieved / delayed).

### §5 Hindrance Log

Every open hindrance with days-impact and status.

---

## Milestone rollup (how a milestone "closes")

Either rule closes a `VillaMilestone`:

1. **★ END-marker rule** — a leaf with `isSubMilestone: true` and category `END` has `actualFinish` set → parent milestone closes on that date.
2. **All-baselined-children rule** — every leaf under the milestone that has a baseline is complete (`percentComplete >= 100`) → milestone closes on the max `actualFinish` of those leaves.

Whichever fires first wins.

---

## Current stage (per villa)

The latest milestone the villa has closed, based on the milestone order.

- If Excavation is closed but Superstructure is not → villa's current stage = "Excavation"
- If nothing closed yet → "Not Started"

---

## Villa numbering (Amanvana)

95 total villas, split across contractors:

| Contractor | Villa count |
|---|---|
| Abraham Thomas | 41 |
| Elegant Construction | 52 |
| "To Be Decided" | 52 (placeholder — reassign later) |

Villa 10 & 11 = single unit in Python's model, two separate rows in Siddhi's DB. Abraham universe includes both numbers for parity.

---

## Access control (who sees what)

Users are either **full-access** (internal White Lotus staff, `modules = null`) or **scoped** (external contractor, `modules = ["QAQC"]` etc.).

### The seven modules

`PROGRESS`, `QAQC`, `SAFETY`, `HINDRANCE`, `CONCERN`, `RFI`, `PERMIT`

### The three gates

| Gate | Applied where | What it does |
|---|---|---|
| **canAccessModule** | Every module endpoint (`/api/rfi`, `/api/hindrances`, etc.) | Scoped user needs the module in their scope; full-access always passes |
| **canAccessScopedRow** | Rows that carry a `module` field (Issue, Inspection) | QAQC-scoped user can act on QAQC rows but NOT SAFETY or general rows |
| **isScopedUser** | Planning-side pages (reports, gantt, timeline, snags, bills, etc.) | Scoped user gets redirected to /mobile |

### Cross-project FK guard

**Rule:** `wbsNodeId` in a POST must belong to the same project as `projectId`. Applies to issues, hindrances, concerns, inspections, RFI, bill lines.

---

## Data integrity rules

| Rule | Where enforced |
|---|---|
| Soft-delete filter — reads never return trashed rows unless caller asks explicitly | Prisma extension in `src/lib/prisma.ts` (12 models) |
| Optimistic lock — every PATCH refuses if the row changed since the client read it | `src/lib/optimisticLock.ts` — every mutable endpoint |
| Idempotency — mobile POSTs de-dupe on `idempotencyKey` | Every mobile-facing POST endpoint |
| Cross-project FK guard | `src/lib/projectFkGuards.ts` |
| Audit trail — every mutation logged with WHO / WHEN / WHAT | `src/lib/audit.ts` → `AuditLog` table |
| Timezone — all human-readable dates rendered in IST | `src/lib/dates.ts` |

---

## Backup + recovery

| Piece | Where |
|---|---|
| **Nightly backup** | GitHub Action at 02:00 IST → private Vercel Blob |
| **Backup verifier** | Same workflow, runs after upload — refuses if backup is under 100 KB or Project/User/WBSNode/Contractor is empty |
| **Alert on failure** | Loud email to Vandana + Shraddha via Resend |
| **Restore** | Neon Point-in-Time Restore (create branch from timestamp) OR download the .sql.gz and `pg_restore` |
| **Retention** | Manual — no auto-cleanup, cost is negligible |

---

## Roles

| Role | Sees desktop? | Sees mobile? | Can create project? | Admin? |
|---|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ | ✓ |
| PLANNER | ✓ | ✗ | ✓ | ✗ |
| PRODUCT_TEAM | ✓ | ✗ | ✗ | ✗ |
| SITE_MANAGER | ✓ | ✓ | ✗ | ✗ |
| SITE_ENGINEER | ✗ | ✓ | ✗ | ✗ |

---

## Ops endpoints (admin-only unless noted)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Public liveness probe (returns 200 or 503 + DB latency) |
| `GET /api/admin/migrate` | List all migrations, applied vs pending |
| `GET /api/admin/migrate?showSql=true` | Preview SQL for pending migrations |
| `POST /api/admin/migrate?dryRun=true` | Report what WOULD run without running |
| `POST /api/admin/migrate` | Apply pending migrations |
| `GET /api/admin/clear-test-data` | Preview what would be wiped |
| `POST /api/admin/clear-test-data` | Wipe (requires `ALLOW_DATA_WIPE=yes` env var + body `{ confirm: "CLEAR_TEST_DATA" }`) |
| `POST /api/admin/restore` | Restore a soft-deleted row |

---

## Files (source of truth)

**Business logic:**
`src/lib/scorecardServer.ts` · `src/lib/weeklyReportServer.ts` · `src/lib/currentStage.ts` · `src/lib/milestoneRollup.ts` · `src/lib/istDay.ts` · `src/lib/holidays.ts` · `src/lib/manpower.ts`

**Colab ingest:**
`src/lib/colabSync.ts` · `src/lib/colabSyncMapping.ts`

**Access control + integrity:**
`src/lib/modules.ts` · `src/lib/roles.ts` · `src/lib/projectFkGuards.ts` · `src/lib/optimisticLock.ts` · `src/lib/dates.ts`

**Ops:**
`scripts/verify-backup.ts` · `scripts/smoke-prod.ts` · `src/app/api/health/route.ts`

Read git log on any file for the change history.
