# MSP Import — Amanvana schedule → Prisma

Loads a real MS Project schedule into the database as Blocks, Villas, MilestoneSections, VillaMilestones, and WBSNodes so the executive dashboard renders live data.

## Two-step workflow

MS Project's `.mpp` binary format is proprietary. We convert it to CSV once with a Python helper, then run our TypeScript importer.

### Step 1 — `.mpp → CSV` (Python + Java + mpxj)

**One-time setup (macOS with Homebrew):**

```bash
brew install openjdk
pip3 install mpxj jpype1
```

**Convert:**

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk
python3 scripts/convert-mpp.py "path/to/Villas Schedule Updated.mpp" scratchpad-data/amanvana_msp.csv
```

The converter walks the MSP task tree and emits one CSV row per task with:
`ID · Outline Number · Outline Level · Task Name · Baseline Start · Baseline Finish · Actual Start · Actual Finish · % Complete · Predecessors · Duration Days · Resource Names`.

A ~100 MB `.mpp` produces a ~750 KB CSV with a few thousand rows in about 15 seconds.

### Step 2 — CSV → Prisma (Node + tsx)

**Requires:** `DATABASE_URL` env var pointing at the target Postgres (Neon in prod, local Postgres in dev), and a seeded `admin` user.

```bash
DATABASE_URL="postgresql://…" \
  npx tsx scripts/import-msp.ts \
    --csv scratchpad-data/amanvana_msp.csv \
    --project "Amanvana" \
    --creator admin
```

**Arguments:**
| Flag | Default | Description |
|---|---|---|
| `--csv` | `scratchpad-data/amanvana_msp.csv` | CSV path (from Step 1) |
| `--project` | `Amanvana` | Project name — created if absent, reused if present |
| `--creator` | `admin` | Username of the user who "owns" the project record |

## MSP outline levels → our data model

| MSP Level | Meaning | Our model |
|---|---|---|
| 0 | Root (`msproj11`) | ignored |
| 1 | Contractor scope (`A&T - (41 Villas)`) | ignored (inferred by convention) |
| 2 | Block (`Block 9`, `Block 3 A`, ...) | `Block` — code parsed as `9`, `3A`, ... |
| 3 | Villa (`Villa 25`, `Villa 10 & 11`) | `Villa` — grouped villas kept as one record with `unitCount=2` and `label="Villa 10 & 11"` |
| 4 | Milestone section (`Foundation / Substructure`) | `MilestoneSection` (once per project) + `VillaMilestone` (once per villa × section) |
| 5 | Task / ★ sub-milestone | `WBSNode` — `isSubMilestone=true` when name contains `★`; linked to its `VillaMilestone` via `villaMilestoneId` |

## Guarantees

- **Idempotent.** Re-running against the same schedule updates existing records; running against a newer schedule updates changed fields.
- **Transactional.** All Prisma writes are wrapped in a single `$transaction` with a 5-minute timeout. If any write fails, the whole import rolls back and the DB is left in its previous state.
- **Non-destructive.** No deletes. If a task disappears from a newer MSP, its previous record is preserved (an audit-friendly default). If you want cascading deletes, remove tasks in a separate migration.

## What the importer does NOT do

- Create users. Seed users first (`npx prisma db seed`).
- Delete blocks / villas / tasks that were removed from the schedule. (Deliberate — the deployed prod database is the source of truth for what's tracked, not the MSP.)
- Import CRM columns (`crmDate`, `crmDelay`, `plannedCollection`) — CRM data comes from a different source and is fed via a separate script (TBD).
- Import Contractor records. Contractors are managed separately in the app.

## Sample run output

```
── MSP Importer ──
  CSV      /Users/…/scratchpad-data/amanvana_msp.csv
  Project  Amanvana
  Creator  admin

Read 7696 rows from …
Hierarchy: 12 blocks · 40 villa records (41 physical units) · 21 distinct sections · 7280 tasks
Project: Amanvana (clh8x…)

── Done in 47.2s ──
  Blocks           12 created · 0 updated
  Villas           40 created · 0 updated
  Sections         21 created · 0 updated
  Villa milestones 840 created · 0 updated
  WBS nodes        7280 created · 0 updated
```

(On re-run against the same schedule, all counts move to the "updated" column.)

## Verification

After a successful import, sanity-check in a Prisma shell:

```bash
npx prisma studio
```

or SQL:

```sql
SELECT count(*) FROM "Block" WHERE "projectId" = '…';   -- expect 12
SELECT count(*) FROM "Villa" WHERE "projectId" = '…';   -- expect 40 rows / 41 units
SELECT count(*) FROM "MilestoneSection" WHERE "projectId" = '…';  -- expect 21
SELECT count(*) FROM "VillaMilestone"
  WHERE "villaId" IN (SELECT id FROM "Villa" WHERE "projectId" = '…');  -- expect 840
SELECT count(*) FROM "WBSNode" WHERE "projectId" = '…';  -- expect ~7280
```
