# Siddhi Version Release Document

Tracks what's in each release, what's planned next, and what's deferred.

- **V0 — pre-launch** (Aug 2026): built the platform, matched Colab parity, tested end-to-end.
- **V1 — launch** (2026-08-31, Monday): Projects team goes live, Colab wound down.
- **V2 — first quarter after launch**: QA/QC + Safety teams onboard, mobile + photo polish, cutover cleanup.
- **V3 — beyond**: analytics, forecasting, more projects.

---

## V0 — Platform build (Aug 2026)

**Not user-facing.** All the below shipped over ~10 days of engineering.

### Data model + ingest
- Postgres schema (Neon) — Project / Villa / VillaMilestone / WBSNode / ProgressEntry / Contractor / Hindrance / Concern / TradePlan / ManpowerEntry / User + audit log.
- MSP import — Microsoft Project `.mpp` schedule → Siddhi WBS + villa milestones. Chunked splitter for large blocks.
- Colab progress import — Colab CSV → WBSNode baselines (aggregate min/max per villaMilestone), ProgressEntry rows, contractor bulk-tagging, weightPct (Physical_Progress). Idempotent with per-chunk retry.
- Colab manpower import — Colab manpower CSV → ManpowerEntry rows.
- Milestone rollup — ★ END-marker closes the milestone, else all-baselined-children rule.

### Reports
- Daily Site Scorecard — 7 sections matching Shraddha's Colab-branded PDFs.
- Weekly Progress Report — 5 sections matching the Amanvana weekly PDF layout.
- Colab-parity confirmed on Aug 26 Abraham view: 8/25 villas · 3/6 blocks (vs Python's 8/25 · 3/6).
- Weekly parity confirmed on Aug 17-23.
- Master Report — weekly per-zone rollup.
- DLR (Daily Log Report) — end-of-day site summary.

### Dashboards + tabs
- Project overview / Progress / My Actions (top tabs — 3 always-visible).
- Full Menu sidebar with Schedule / Data Entry / Records / Reports & Docs / Finance groups.
- QA/QC / Safety / Insights tabs — placeholder shells (hidden from V1 nav; content deferred to V2).

### Mobile
- Mobile-only role (Site Engineer) — auto-redirect to `/mobile`.
- Simplified home: 3 actions (Add Progress, Manpower, DLR).
- Progress form with camera capture (up to 4 photos), delay reason picker, offline queue with retry.

### Design
- DM Serif Display + Open Sans (Google Fonts).
- Colab palette — charcoal #161926, cream #FBF7EE, gold #CA9F49, sandstone / ferrous accents.
- A4 print styles on both reports.

### Auth / users / audit
- NextAuth v5 with JWT credentials login.
- Roles: SITE_ENGINEER, SITE_MANAGER, PLANNER, PRODUCT_TEAM, ADMIN.
- Audit log for every progress edit, concern move, inspection change.

### Infra
- Vercel serverless deploy.
- Vercel Blob for photo storage.
- Client-side chunking + retry for imports (survives Vercel's 5-minute function limit).

---

## V1 — Launch (2026-08-31, Monday)

### Everyone on Monday
- **Site engineers** log daily progress + manpower + DLR from their phones.
- **PMs** open the Daily Scorecard each morning to review yesterday.
- **Management** gets the Weekly Report every Monday.

### What's in scope for V1
- Projects team only.
- Amanvana Phase 1 (Abraham 41 villas + Elegant 52 villas).
- Two reports (Daily + Weekly) — direct 1:1 replacements for Colab-generated PDFs.
- Cheat sheets (engineer + PM) distributed on Sunday.

### What's out of scope for V1
- QA/QC team workflows.
- Safety team workflows.
- Insights (predictive callouts) — placeholder shell only.
- Photo import from Colab history (existing Colab photos stay in Colab).
- Bill / Expense workflows (form exists, not primary use case).
- Push notifications.

### Success criteria
- All Projects team engineers log at least one entry on Monday.
- Daily Scorecard PDF matches Colab's for Monday, generated same day.
- No P0 bugs blocking daily use.

### Rollback plan
- If something breaks: engineers fall back to WhatsApp reporting + a Google Sheet for the day.
- No data loss — every entry is in Postgres (Neon), backed up.

---

## Coding patterns (in effect from 2026-08-30)

### API request-body validation — always use zod + parseBody

Every new `/api/**/route.ts` that parses a JSON body must use the shared
`parseBody` helper in `src/lib/parseBody.ts`, with a zod schema. This
enforces validation at the type level and returns structured 400 errors.

```typescript
import { z } from "zod";
import { parseBody } from "@/lib/parseBody";

const BodySchema = z.object({
  contractorId: z.string().min(1),
  scope: z.enum(["untagged", "block", "villa"]),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;   // fully typed
  ...
}
```

Discriminated unions (`z.discriminatedUnion("scope", [...])`) work well
when a field's validity depends on other fields — see
`api/projects/[id]/contractor-assign/route.ts` for the pattern.

## V1.5 — Tech-debt cleanup (first 2 weeks post-launch)

From the code review on 2026-08-29, take these before scaling to more projects:

1. **Split `src/lib/colabSync.ts` (~875 lines) into named phases** — parse → resolve → per-row match → bulk ColabActivity write → milestone-agg apply → rollup → post-rollup override. The "override after rollup" section is a smell — the rollup semantics themselves need reconciling.

2. **Unify the migration story.** Currently `schema.prisma` + `schema.sql` + in-app `MIGRATIONS[]` are three sources of truth kept in sync by hand. Lock the in-app route after cutover and rely on Prisma Migrate for future changes.

3. **Extract hardcoded 41/52 villa scope map from `src/lib/scorecardServer.ts:41,404`** into project-level config (JSON on Project, or a `contractor_scope_override` table). Hardcoding guarantees a bug when the next project needs the same pattern.

4. **Add zod for API request-body validation.** Each route hand-narrows types (~30 lines each). One shared `parseBody(schema, req)` deletes half of every route.

5. **Gate or replace `src/lib/executiveMockData.ts` fallback content.** Overview / Snapshot / Layout tabs use it as filler; either wire the real feeds or hide those tabs completely (currently hidden from V1 nav but reachable by URL).

### Weekly Report Python-parity — remaining structural gaps (found on 2026-09-02)

Compared the deploy vs a live render of `scripts/gen_wk23.py` on the same fixture. Cosmetic four (em-dashes, hero label, block padding, dot separator) are landed. Three deeper gaps still open:

6. **Milestone stage taxonomy diverges.** Python's MORDER is 9 stages — `Footing`, `Plinth Beam`, `Gr Floor Slab`, `Gr Floor Blockwork`, `1st Floor Slab`, `1st Floor Blockwork`, `2nd Floor Slab`, `2nd Floor Blockwork`, `Villa Handover`. Our DB has the MSP-imported 21-section names — `Foundation / Substructure`, `Plinth Level`, `Ground Floor Structure`, etc. So the same villa shows "V26 Plinth Beam" in Python and "V26 Plinth Level" in the deploy. Decide: (a) rename our sections to Python's 9 stages, (b) add a display-name alias so the UI shows Python names but the DB stays MSP-native, or (c) accept the drift.

7. **Historical contractor state not snapshotted.** For wk23 (Aug 17–23), Python shows "Contractor 2 — To Be Decided / Award pending" because Elegant hadn't been awarded yet. Our deploy shows "Contractor 2 — Elegant Construction" for every historical week because we render today's contractor state. Fix: snapshot contractor name + status per week (a `contractor_history` table or `awardedAt`/`retiredAt` timestamps on `Contractor`).

8. **§3 per-item Delay reason column blank on the deploy.** Python shows "Change orders" per row for the villas where a reason is logged; ours shows "not recorded" on every row. The `reasonByMilestone` lookup in `weeklyReportServer.ts` isn't finding matches — likely a small server-side fix (wbsNode → villaMilestone join not populating), separate from the §5 aggregation fix that just landed.

### Zod migration rollout — 32 of 34 done (Tier 2.1)

`parseBody` + zod is the standard for API request bodies. Only 2 routes remain, and they take multipart form-data with special handling — parseBody would need a matching multipart helper before they can migrate:

- `/api/admin/import-msp` (POST)
- `/api/admin/import-colab-progress` (POST)
- `/api/admin/import-colab-manpower` (POST)

The JSON fallback paths in those imports already do sanity checks (CSV size < 20 MB, header shape, `csv` key present) so they're not un-validated — just not on the same `parseBody` pattern as the rest. Full parity is a small helper away.

Every other write endpoint now enforces its inputs at the boundary: type shape, string length limits, numeric bounds (0-1e6 quantities, 0-100%, 0-500 headcount, etc.), enum validity, URL shape. Invalid JSON returns a clean 400 with a Zod `details` array. Track adoption via presence of `import { z } from "zod"` in the route file.

### Rate limiting — recommend enabling Vercel Firewall (Tier 2.4)

Middleware ships a per-instance burst-limit (100 req / 10 sec / IP on `/api/*`) that catches obvious script hammering, but Vercel's serverless model means separate instances have separate counters — sustained abuse from many IPs slips through. Fix in Vercel dashboard: **Firewall → Rate Limiting → Create rule**: match `/api/*`, threshold ~600 req/min per IP, action = challenge or block. Free tier includes basic rate limiting; higher-scale needs a paid Attack Challenge Mode subscription.

### Sentry error monitoring (Tier 2.5 — needs DSN)

Error boundaries at `src/app/error.tsx` and `src/app/global-error.tsx` already call `window.Sentry?.captureException?.()`. No-op until the SDK is installed. Once `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel env vars:

  npm install @sentry/nextjs
  npx @sentry/wizard@latest -i nextjs

That auto-generates `sentry.client.config.ts` + `sentry.server.config.ts` + edge config + `instrumentation.ts` and reads the DSN from the env var. The boundaries pick up the global `window.Sentry` automatically — no code changes needed.

### Missing DELETE endpoints — closed 2026-09-03

All 6 record types now have DELETE handlers (commit `eef896a`):

- `/api/hindrances/[id]` DELETE — creator or admin, soft-delete via `deletedAt`
- `/api/concerns/[id]` DELETE — raiser or admin
- `/api/issues/[id]` DELETE — creator or admin
- `/api/rfi/[id]` DELETE — raiser or admin
- `/api/manpower-entries/[id]` DELETE — logger or admin (new route file)
- `/api/admin/contractors/[id]` PATCH + DELETE — admin only. DELETE flips `active: false` (contractor rows are referenced by many FK-owning tables so hard-delete is off the table; retiring hides them from active pickers instead).

Restore endpoint (`/api/admin/restore`) extended to accept `Rfi` and `ManpowerEntry` alongside the existing five. List queries for hindrance / concern / issue / rfi now filter `deletedAt: null` so soft-deleted rows don't leak into the UI.

Remaining piece on the client side: add ✕/Remove affordances in the desktop lists + mobile flows so users can actually call these endpoints from the UI. Small per-form edit; can piggyback on the Tier 1.5 client-side rollout.

### Tier 3 walkthrough (2026-09-03) — perf findings

Walked every navigable route on the deploy as admin. Zero 500s across 34 tested routes. Real bugs found:

**Critical perf**
- `/reports/master` — **~10 seconds**. Attempted fixes so far:
  - Page-level location-path lookup: **fixed** in `efa7472` (walks only ancestors of highlight rows, ~200 rows instead of 14k).
  - `getMasterReport()`, `getWeeklyReport()`, `getScorecard()` wrapped in `unstable_cache` with 60s TTL in `0e6a1ca` + `7ad8f02`. **Measured no improvement live** — either Vercel's Data Cache isn't enabled on this project, or dynamic-route rendering bypasses the cache. Worth checking Vercel dashboard → Data Cache to confirm.
  - Real perf fix still open: refactor `getMasterReport`'s reductions to Postgres `SUM/MIN/MAX` aggregates instead of pulling every leaf row. ~1 day. Punchlisted for the perf pass.
- Not a demo blocker — page is functional, just slow.

**Noticeable perf** (functional but slow — > 1.5s server render):
- `/reports/weekly` — 2.8s
- `/reports/scorecard` — 2.6s
- `/projects/[id]/overview` — 2.9s (executive dashboard; may be the same 14k WBSNode fetch pattern)
- `/projects/[id]/gantt` — 2.3s (large Gantt render — likely fine, but worth checking client-side hydration)
- `/projects/[id]/progress` — 1.7s
- `/admin/audit` — 1.5s
- `/projects/[id]/look-ahead` — 1.4s

**All good**
- Mobile: every route < 800ms
- Switch Project modal (post-portal-fix): renders full-viewport, closes cleanly
- Executive overview: numbers look plausible, no obvious mock leak

### Mobile offline queue (Tier 2.3 — deferred pending site check)

Shraddha to check whether cellular signal is genuinely poor at Amanvana before we commit to this. If site coverage is decent, this can slide to V2. If engineers frequently lose submits mid-request, do it before scaling to more projects.

Scope when we do it: submit-with-retry queue on the mobile client so a bad-signal moment doesn't drop a progress entry, hindrance, or photo. Design decisions still open:

1. Silent auto-retry or explicit "queued" UI?
2. Retry backoff (immediate → 30s → 5m → give up?)
3. Photo upload chunking or leave as one PUT?
4. Conflict handling when a queued edit hits a row that changed while offline (ties into the Tier 1.5 concurrency guard — server would return 409 on the retry).
5. Local storage: IndexedDB via a queue library (e.g. `workbox-background-sync`) or a simple hand-rolled queue?

Estimate: ~1 week once scope + design are agreed.

### Concurrency guard — server complete (Tier 1.5)

Optimistic-locking helper at `src/lib/optimisticLock.ts` now wired into every mutable PATCH endpoint (12 total):
concerns, issues, hindrances, rfi, progress, drawings, permits, projects, inspections, bills, expenses, admin/users.

**Server side: done.** All PATCH endpoints accept `expectedUpdatedAt` and return 409 with the current row's `updatedAt` on mismatch.

**Client side: still to do.** Every edit form on desktop + mobile needs to (a) capture the `updatedAt` returned from the read, and (b) echo it back on save. Track adoption via presence of `expectedUpdatedAt` in the payload; the server logs a warning inside `checkConflict` when clients don't send it. Once every form is sending it, flip the helper from "no-op when absent" to "require present".

### Pre-launch hardening sweep (2026-09-04 → 2026-09-08)

Six-day pass covering correctness, security, ops safety, and pre-launch UX. **37 commits.** Everything below is on `main` and covered by tests (267 passing).

**Access control — 12 gaps closed.**
- Write paths: `/api/issues/[id]`, `/api/inspections/[id]`, `/api/expenses/[id]` PATCH+DELETE now gate on scoped-user module ownership. A QAQC-scoped contractor can no longer resolve a SAFETY snag by direct id.
- Read paths: `/api/users` (assignee picker), `/api/projects/summary`, `/api/projects/[id]/drawings`, `/api/projects/[id]/trade-plans`, `/api/projects/[id]/activities/for-milestone`, `/api/inspections` GET, `/api/issues` GET all refuse scoped external contractors.
- New helper `canAccessScopedRow(userModules, rowModule)` in `src/lib/modules.ts` with 4 unit tests.
- 16 planning-side pages (all reports, gantt, timeline, snags, bills, look-ahead, add-progress, contractor-assign, insights) gated on `isScopedUser` — defense-in-depth in case a scoped user is provisioned with a non-mobile role.

**Data integrity — 15 gaps closed.**
- Soft-delete auto-filter extended to RFI, Permit, ManpowerEntry, TradePlan — was previously only 8 of 12 deletedAt models.
- 4 multi-step writes wrapped in `$transaction`: Colab manpower trade-plan wipe+reinsert, Colab progress per-row (WBS update + entry write + photo attach), MSP project.create + sections/blocks/villas, WBS import contractor upserts.
- 7 cross-project FK guards: `wbsNodeId` on POST rfi/hindrances/inspections/issues/concerns/bills, PATCH bills. Client can no longer post `projectId: A, wbsNodeId: node-in-B`. New helper `src/lib/projectFkGuards.ts` with 7 unit tests + e2e coverage.
- `formatDayMonthYear` and new `formatDayMonthYearTime` pinned to Asia/Kolkata — closes the "snag raised at 03:00 IST shows on server-render as yesterday" bug (React hydration warnings + real user confusion). 11 unit tests.
- Colab manpower import switched from findUnique-then-create to upsert-with-restore — trashed rows now restore-and-update instead of getting silently mutated OR crashing on the unique-composite key.

**Traceability — 7 gaps closed.**
- Audit trail added to: admin/users POST (user provisioning), admin/users/[id]/password POST (password reset — logs WHO reset WHOSE, never the hash), projects POST, projects/[id]/import (WBS bulk import — annotates replace-mode), projects/[id]/drawings POST, both colab imports (live runs only, not dry-run).
- New `ProjectDrawing` entity type in the `AuditEntityType` union so drawings entries stop aliasing to `Project`.
- Audit-log filter chips synced with the current entity/action union — admin can now filter by RFI, Permit, ManpowerEntry, TradePlan, and 5 other types that were missing from the chip list.
- Audit filter project/user dropdowns actually work now — were orphan `<select>` elements without a form wrapper, picking a value did nothing.

**Ops safety.**
- `scripts/verify-backup.ts` — pulls the most recent nightly `.sql.gz` from private Blob store, gunzips, parses COPY blocks, counts rows per table. Fails loud if the backup is under 100 KB or if Project / User / WBSNode / Contractor come back with 0 rows. Wired as the last step of the backup workflow — a broken backup now surfaces inside the same run, not 10 days later. 7 unit tests for the parser.
- `seed.ts` + `demo-seed.ts` refuse to run against a Neon host (URL pattern check) OR without an explicit `ALLOW_SEED=yes` / `ALLOW_DEMO_SEED=1` env var. CI opts in explicitly. Closes the "someone runs seed against prod and drops five weak-password accounts" failure mode.
- `/api/admin/migrate?dryRun=true` returns the SQL that WOULD execute for every pending migration without running it. `?showSql=true` on GET does the same for inspection. Three-request flow: GET-showSql → POST-dryRun → POST-real.
- `/api/health` — unauthenticated liveness probe for external uptime monitors. 200 with `db.latencyMs` on healthy, 503 with error on DB failure, no-store cache header.
- `clear-test-data` extended from 6 to 20 tables — pre-launch reset now wipes RFIs, permits, manpower, trade plans, expenses, bills, drawings, and their photo/line children.
- Login timing-attack channel closed — `authorize()` now always runs `bcrypt.compare` (against a DUMMY_HASH when the user doesn't exist), so response time no longer reveals which usernames are valid.
- Sentry hooks in `error.tsx` + `global-error.tsx` — the `window.Sentry` pattern was dead code (modern `@sentry/nextjs` doesn't attach to window). Now imports directly; captures land the moment `NEXT_PUBLIC_SENTRY_DSN` is pasted into Vercel env.
- `beforeunload` warning on `PendingSyncBadge` — site engineers with pending offline entries now get the browser's native "you have unsaved changes" prompt before closing the tab.
- `smoke-prod.ts` expanded to cover RFI, Permit, ManpowerEntry, TradePlan — the four modules the previous smoke was blind to.

**Pre-launch UX.**
- `/my-actions` now shows snags AND RFIs assigned to me, not just concerns + inspections. Assignment emails link here and previously landed users on an empty page.
- `⟳ Generate strong password` button on both the create-user form and the reset-password dialog. One click produces `mango-cedar-willow-4271`-shape memorable password, auto-fills both password + confirm, un-masks the input, offers Copy to clipboard. Real friction reduction for handing credentials to 15 team members without ending up with `password123` everywhere.
- TrashButton wired to inspection + permit desktop lists (last two gaps).
- Client concurrency echo wired to `admin/users`, `projects`, `progress` — the last three PATCH forms where the server guard existed but the client wasn't participating. Optimistic-lock coverage now complete on both sides for every mutable endpoint that has an `updatedAt` column.
- Zod validation added to the three admin/import routes (`import-msp`, `import-colab-progress`, `import-colab-manpower`) — closes the write-endpoint validation gap for every remaining route.

## V2 — First quarter after launch (Sept–Nov 2026)

### QA/QC team
- Inspections module with checklist templates (scope TBD by Shraddha).
- Inspection status flow: Draft → In Review → Closed.
- Defects tracked per villa, linked back to activities.
- Contractor QA/QC scorecard.

### Safety team
- Safety checklists (scope TBD by Shraddha).
- Incident reporting.
- Induction tracking.
- Permit-to-work flow.
- Contractor safety compliance scorecard.

### Mobile polish
- Push notifications (site engineer when inspection assigned).
- Colab-style mobile Add Progress screen comparison and matching.
- Photo import from Colab history (backfill).
- Mobile-optimised Daily Scorecard view (currently mobile just shows the desktop PDF).

### Cutover cleanup
- Remove Colab import UI (only Amanvana admin should see it, once migration is complete).
- Remove Colab-specific mapping tables that we no longer need.
- Deprecate manpower CSV import once engineers log manpower directly.

### PM tooling
- Contractor bulk-reassign UI polish.
- Weekly Report export in multiple formats (PDF, DOCX, XLSX).
- Custom date-range reports.

---

## V3 — Beyond (Q1 2027+)

- Multi-project rollup (portfolio view for the leadership team).
- Delay-cause analytics with drill-through (predictive: "these 5 villas will slip if X").
- Client-facing progress view (buyer sees their own villa's status).
- Cost + schedule integration (billing + budget vs actual).
- BIM viewer for the interactive drawing tab.

---

## Release history

| Date | Version | Notes |
|---|---|---|
| 2026-08-19 | V0.1 | Auth + basic project shell |
| 2026-08-22 | V0.2 | MSP schedule import |
| 2026-08-24 | V0.3 | Colab progress import v1 |
| 2026-08-26 | V0.5 | Daily Scorecard + Weekly Report shipped |
| 2026-08-28 | V0.9 | Full Colab-parity work + brand match |
| 2026-08-29 | V0.10 | Weekly Report parity, PDF export polish, PWA |
| 2026-08-31 | V1 | Code-complete for launch scope |
| 2026-09-03 | V1.5 | Perf, DELETE endpoints, zod migration, concurrency helper |
| 2026-09-08 | V1.6 | Pre-launch hardening sweep (access control, integrity, ops, UX) — 37 commits |
| TBD (Sept 2026) | **V1.7** | **Actual launch — Projects team goes live on Amanvana** |
| TBD | V2 | QA/QC + Safety + mobile polish |

_This document should be updated whenever a scoped batch of features ships._
