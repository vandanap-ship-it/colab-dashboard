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
| 2026-08-31 | **V1** | **Launch — Projects team live** |
| TBD | V2 | QA/QC + Safety + mobile polish |

_This document should be updated whenever a scoped batch of features ships._
