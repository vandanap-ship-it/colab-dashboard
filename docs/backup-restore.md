# Backup & Restore

Data loss is the one failure mode we can't recover from. Everything else is fixable.

## Defense in depth

Three independent layers so no single failure loses everything:

| Layer | What | Frequency | Where | Retention |
|---|---|---|---|---|
| **1 · Neon PITR** | Built-in point-in-time recovery on the Neon paid tier | Continuous (WAL) | Neon-managed | 7 days |
| **2 · GitHub Action nightly** | `pg_dump` → Vercel Blob | Every night 02:00 IST | Vercel Blob + GitHub artifact | 30 days (artifact); Blob unlimited |
| **3 · Email digest** | Daily link to latest Blob backup | Same run as #2 | vandana.p@ + shraddha.b@whitelotusgroup.in inboxes | Forever (mail archives) |

Layer 1 is fastest to recover from (browser click in Neon dashboard). Layer 2 is our escape hatch if Neon itself goes down. Layer 3 is proof-of-life — a missing email is the alarm.

## Layer 1 — Neon PITR

Turn on the **Scale plan ($19/mo)** for Amanvana's Neon project. That unlocks:
- 24-hour rewind on Free
- **7-day point-in-time recovery on Scale**
- Branching (make a throwaway branch to test a rollback before applying to main)

**To restore:** Neon dashboard → project → "History" → pick a timestamp → "Restore" (or "Create branch from this point" for a safer preview).

## Layer 2 — GitHub Action nightly backup

Lives at `.github/workflows/backup.yml`. Runs at **02:00 IST daily** and on manual trigger from the Actions tab.

What it does:
1. Installs `postgresql-client-18` (matches Neon's server version, 18.6 as of Sep 2026)
2. `pg_dump --no-owner --no-acl --format=plain | gzip` → `siddhi-backup-YYYY-MM-DDTHH-MM-SSZ.sql.gz`
3. Uploads to Vercel Blob under `backups/YYYY-MM/`
4. Also uploads to the GitHub workflow's own artifact store (30-day retention, fallback if Blob token is missing)
5. Sends an email digest via Resend (skipped silently if `RESEND_API_KEY` missing)

### Repository secrets required

Set these under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required? | Value | Where to get it |
|---|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string | Neon dashboard → connection details |
| `BLOB_READ_WRITE_TOKEN` | Yes for off-cloud copy | Vercel Blob token | Vercel dashboard → project → Storage → Blob → `.env.local` |
| `RESEND_API_KEY` | No (skipped if absent) | Resend API key | resend.com → API Keys |
| `BACKUP_EMAIL_RECIPIENTS` | No (defaults to vandana + shraddha) | Comma-separated emails | — |

### Manual run

Actions tab → "Nightly DB backup" → "Run workflow" → pick branch → Run.

### On-demand from a laptop

```bash
# One-time setup on macOS
brew install postgresql@17

# Run the backup — leaves file in cwd
DATABASE_URL="postgresql://..." \
  BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..." \
  ./scripts/backup-db.sh
```

If `BLOB_READ_WRITE_TOKEN` is not set, the script still produces the `.sql.gz` file locally — you can upload it manually or keep it as a working copy.

## Layer 3 — Email digest

Once Resend is wired, the nightly workflow appends a step that emails the Blob download link to `vandana.p@whitelotusgroup.in` and `shraddha.b@whitelotusgroup.in`.

**Signal:** if you don't see a "Siddhi backup ready" email one morning, something is broken.

**Custom recipients:** set `BACKUP_EMAIL_RECIPIENTS` repo secret to a comma-separated list.

## Restore procedures

### Restore from Neon PITR (preferred — 30 seconds)

1. Neon dashboard → project → **History**
2. Scroll to the timestamp you want
3. Click **Create branch from this point** — makes a `restore-YYYY-MM-DD` branch off that snapshot
4. Verify the branch by connecting to it (dashboard shows the connection string)
5. If verified good: Neon dashboard → Settings → set the branch as the new primary (or copy data across)

### Restore from Blob backup (last resort — 10 minutes)

1. Grab the latest `.sql.gz` from Vercel Blob (link is in the daily email or in the Blob dashboard under `backups/`)
2. `gunzip siddhi-backup-YYYY-MM-DDTHH-MM-SSZ.sql.gz`
3. **Create a fresh Neon branch** (never restore over primary directly)
4. `psql "postgresql://<fresh-branch-url>" < siddhi-backup-YYYY-MM-DDTHH-MM-SSZ.sql`
5. Verify: `psql "postgresql://<fresh-branch-url>" -c "SELECT COUNT(*) FROM \"WBSNode\";"`
6. Promote the branch to primary once verified.

## Monitoring

- **Backup workflow failing?** GitHub → Actions tab → failed run has full logs.
- **Missing daily email?** Check the workflow ran (Actions tab) — if it ran but email step warned, `RESEND_API_KEY` might be missing/expired.
- **Neon paid tier?** Neon dashboard → Settings → Billing shows current plan. Free tier keeps PITR to 24 hours only — verify Scale is on.

## What we DON'T do (deliberate)

- **No automatic restore endpoint.** A one-click restore in the app is a footgun — could nuke prod. Restore is always a manual, deliberate act.
- **No compressed image backup.** Photos in Vercel Blob are already durable (multi-AZ replication). We don't double-backup them.
- **No cross-region replication yet.** Bombay region is fine for single-app deployments; add Singapore mirror only if we outgrow that.
