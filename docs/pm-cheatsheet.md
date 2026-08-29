# Siddhi — PM Cheat Sheet

**Who this is for:** you, the Projects team lead reviewing engineer logs.
**When to use it:** each morning to check yesterday, each Monday to plan the week.

---

## Sign in

- URL: `siddhi-whitelotus.vercel.app`
- Type your username + password.

## Landing page

- Shows all your projects. Click **Amanvana - Phase 1** to open it.

## Project home has 3 top tabs

| Tab | What it does |
|---|---|
| **Dashboard** | Health, delay clusters, milestones — one screen for the whole project |
| **Progress** | Interactive site drawing + per-villa progress |
| **My Actions** | Concerns and inspections assigned to you |

Everything else is one click away under the **Menu** button (top right).

---

## Menu → what lives where

- **SCHEDULE** — Timeline, Look-ahead (5-day view), Gantt
- **DATA ENTRY** — Add Progress (rare, engineers do this on mobile), Manpower, Import schedule
- **RECORDS** — Snag Master, RFI, Permits
- **REPORTS & DOCS** — DLR, **Reports** (the daily + weekly PDFs), Drawings, Logic Reference
- **FINANCE** — Billing, Expenses

---

## The two reports you'll open every day

### Daily Scorecard
- Menu → Reports & Docs → **Reports** → **Site Progress Scorecard**
- Pick the date (default = today).
- Pick the contractor filter (default = All contractors, switch to Abraham Thomas or Elegant for a contractor-only view).
- Click **Download PDF** — it uses browser print. In the print dialog:
  - Set **Destination: Save as PDF**
  - Set **Layout: Portrait**, **Paper: A4**, **Margins: Default**
  - Turn **Background Graphics: ON** (this keeps the colors + brand look)
  - Save.

### Weekly Report
- Same path → **Weekly Progress Report**.
- Pick the week ending (default = last Sunday).
- Same Download PDF flow.

---

## Reading the Daily Scorecard

| Section | What it tells you |
|---|---|
| §1 Daily Site Snapshot | Did anyone log? How many contractors / blocks / villas moved out of what was expected today. |
| §2 Daily Movement | Same numbers, broken down per contractor. "Not updated" = villas that were expected today but didn't log. |
| §3 Planned Coverage by Block | Which villas in each block logged (green chip) vs didn't (plain chip). Gold-edged chip = logged even though not expected today. |
| §4 Site Activity Highlights | Every activity logged today, with % complete, remark, delay reason, photo. |
| §5 Milestone Progress | Which milestone every villa is currently on. |
| §6 Block-wise Progress | Planned vs actual dates per block. |
| §7 Project Health | Overall pace vs the master schedule. |

---

## Reading the Weekly Report

| Section | What it tells you |
|---|---|
| §1 Overall Progress | Total planned % vs actual % of project completion, at week end. |
| §2 Milestone Plan | For each contractor: how many milestones were supposed to complete / start / be in progress this week — and how many actually did. |
| §3 Stalled | Milestones that are "in progress" but haven't moved for X days. |
| §4 Manpower | Weekly headcount by trade — planned vs achieved. |
| §5 Delay Reasons | Every recorded delay reason clustered, with recommended mitigation. |

---

## Everyday admin

- **Assign a contractor to villas** — Menu → Contractors (top nav) → pick contractor → assign villas.
- **Fix a wrong progress entry** — Menu → Trash → restore or delete.
- **See what changed** — top nav → Audit.

---

## When numbers look wrong

- **A villa's not showing in the scorecard** — check it exists in Menu → Data Entry → Import schedule, and check the contractor is assigned.
- **Weekly numbers don't match my Python** — the Colab progress import may not have run since new activity was added. Re-run: Menu → Data Entry → Import schedule → upload the latest Colab CSV.
- **Photo not loading** — likely a Vercel Blob issue. Check with dev.

---

## Who to call

- Report shows the wrong number: **{dev contact}**
- Login trouble for an engineer: your admin login can reset from Menu → Users
