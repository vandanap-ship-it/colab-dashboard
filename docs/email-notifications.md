# Email Notifications

Three flows, one wrapper (`src/lib/email.ts`). All templates render server-side and dispatch via Resend's HTTP API — no SDK dependency.

## The three flows

| Flow | Trigger | Recipient(s) | Where |
|---|---|---|---|
| **Task assignment** | When a Concern/Issue/Task gets `assignedToId` set | Just the assignee | `assignmentEmail()` — wire into the assignment API route |
| **Milestone completion** | When a `VillaMilestone.pctComplete` flips to 100 | `vandana.p@` + `shraddha.b@whitelotusgroup.in` | `milestoneCompletionEmail()` — wire into the milestone update route |
| **Overdue baseline digest** | Nightly cron (03:00 IST) | `vandana.p@` + `shraddha.b@whitelotusgroup.in` | `/api/cron/overdue-digest` (`src/app/api/cron/overdue-digest/route.ts`) |

## Environment variables

Set these on Vercel (Project → Settings → Environment Variables):

| Variable | Required? | Value | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | Yes | `re_...` from resend.com/api-keys | Without this every `sendEmail` call is a no-op with `{skipped: true}` |
| `CRON_SECRET` | Yes for prod | Any long random string | Vercel Cron passes it as `Authorization: Bearer ${CRON_SECRET}`. The route rejects requests with mismatched or absent header when the env var is set |
| `NEXT_PUBLIC_APP_URL` | Recommended | `https://siddhi-whitelotus.vercel.app` | Falls back to `NEXTAUTH_URL` then a hardcoded default. Used to build dashboard links in email bodies |

**Resend setup (one time):**
1. Sign up at [resend.com](https://resend.com) with `noreply@whitelotusgroup.in` verified as sender
2. Add domain `whitelotusgroup.in` under Resend → Domains → follow the SPF/DKIM instructions
3. Once verified, mint an API key (Full access is fine — Resend has no destructive endpoints)
4. Paste key into Vercel env vars → redeploy

## Vercel Cron

`vercel.json` declares:

```json
"crons": [
  { "path": "/api/cron/overdue-digest", "schedule": "30 21 * * *" }
]
```

= **21:30 UTC daily = 03:00 IST next morning**. Same slot as the nightly backup (backup runs at 20:30 UTC = 02:00 IST). Vercel handles the scheduling — no OS-level cron needed.

## The "no-op if unconfigured" contract

Every place we call `sendEmail`, missing config is treated as *deliberate opt-out*, not failure:

- No `RESEND_API_KEY` → `sendEmail()` returns `{ ok: true, skipped: true }` and logs an info line
- Resend returns 4xx/5xx → `sendEmail()` returns `{ ok: false, error: "..." }` — the caller can retry or log, but the app keeps running
- Fetch throws (network down) → same as above, no exception bubbles up

**Why:** email is a courtesy, not core functionality. A failing email server must never take down a progress-entry submission or a milestone update. The dashboard is source of truth; email is a convenience notification.

## Testing without spamming yourself

- Unit tests cover template renderers (subject, HTML body, chip variants). They never call Resend.
- `sendEmail` is tested with a mocked `fetch` — verifies auth header, error paths, and no-op behaviour.
- Local dev: leave `RESEND_API_KEY` unset. Emails will log "skipping" instead of dispatching.
- Local integration test: set `RESEND_API_KEY=re_test_...` and hit `/api/cron/overdue-digest` — a real email arrives.

## Wiring the trigger hooks

The two entity-driven flows (assignment + milestone completion) don't run yet. To activate them, add calls in the relevant API routes:

**Assignment (`src/app/api/concerns/[id]/route.ts` and siblings)** — after the PATCH sets a new `assignedToId`:
```ts
if (newAssigneeId !== previous.assignedToId) {
  const assignee = await prisma.user.findUnique({ where: { id: newAssigneeId } });
  if (assignee?.email) {
    await sendEmail(assignmentEmail({
      to: assignee.email,
      assigneeName: assignee.name,
      itemType: "Concern",
      itemTitle: concern.description.slice(0, 80),
      itemUrl: `${SIDDHI_BASE_URL}/projects/${concern.projectId}/my-actions#concern-${concern.id}`,
    }));
  }
}
```

**Milestone completion (`src/app/api/villa-milestones/[id]/route.ts`, TBD)** — after `pctComplete` becomes 100:
```ts
if (wasNotComplete && isNowComplete) {
  await sendEmail(milestoneCompletionEmail({
    projectName: project.name,
    villaLabel: villa.label ?? `Villa ${villa.number}`,
    sectionName: section.name,
    actualFinish: milestone.actualFinish!,
    baselineFinish: milestone.baselineFinish,
    dashboardUrl: `${SIDDHI_BASE_URL}/projects/${project.id}/snapshot`,
  }));
}
```

These are scaffolded but not yet inserted into the routes — pending the villa-milestone API surface which comes with the executive dashboard wire-up (Phase 2b).
