#!/usr/bin/env bash
# ─── Colab → Siddhi MERGE import (no wipe) ──────────────────────────────────
# Re-runs the safety-domain importers against a newer Colab export. Each
# importer skips rows whose idempotencyKey already exists, so only rows
# that are new in Colab get inserted. Nothing is deleted or updated.
#
# Checks before touching data:
#   1. DATABASE_URL is a real Neon URL (not a placeholder)
#   2. every CSV exists in CSV_DIR
#   3. backs up the DB via scripts/backup-db.sh (needs pg_dump 18 to match Neon)
#   4. asks for `yes` typed at the terminal
#
# Usage:
#   export DATABASE_URL='postgresql://...neon.tech/...'
#   bash scripts/colab-merge-import.sh
#
# Optional env:
#   CSV_DIR        default: ~/Downloads/Colab tools report - oct 7th
#   PROJECT_NAME   default: Amanvana
#   CSV_INDUCTIONS / CSV_PERMITS / CSV_CHECKLISTS   override file names
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CSV_DIR="${CSV_DIR:-$HOME/Downloads/Colab tools report - oct 7th}"
PROJECT_NAME="${PROJECT_NAME:-Amanvana}"
CSV_INDUCTIONS="${CSV_INDUCTIONS:-2026-10-07_09d242c4-9212-4240-811e-608ec91c3e84.csv}"
CSV_PERMITS="${CSV_PERMITS:-20261007_455be263-575c-4fbe-a28a-a91140ec3a89.csv}"
CSV_CHECKLISTS="${CSV_CHECKLISTS:-20261007_db270d8e-b22b-4551-8f89-bd6b29c0bc0a.csv}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is not set." >&2
  exit 1
fi
if [[ "$DATABASE_URL" != postgresql://* && "$DATABASE_URL" != postgres://* ]] || [[ "$DATABASE_URL" != *neon.tech* ]]; then
  echo "✗ DATABASE_URL doesn't look like a Neon connection string." >&2
  echo "  It should start with postgresql:// and contain neon.tech." >&2
  exit 1
fi

for f in "$CSV_INDUCTIONS" "$CSV_PERMITS" "$CSV_CHECKLISTS"; do
  if [ ! -f "$CSV_DIR/$f" ]; then
    echo "✗ CSV not found: $CSV_DIR/$f" >&2
    exit 1
  fi
done
echo "✓ Connection string and all 3 CSVs found in: $CSV_DIR"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "✗ pg_dump not found — can't take a backup. Install it with:" >&2
  echo "    brew install postgresql@18 && brew link --overwrite --force postgresql@18" >&2
  exit 1
fi
bash "$(dirname "$0")/backup-db.sh"
echo "✓ Backup done"

echo
echo "About to MERGE into project \"$PROJECT_NAME\" (insert new rows only, no wipe):"
echo "  Safety Inductions  ← $CSV_INDUCTIONS"
echo "  Work Permits       ← $CSV_PERMITS"
echo "  HSE Checklists     ← $CSV_CHECKLISTS"
read -r -p "Type yes to continue: " answer
if [ "$answer" != "yes" ]; then
  echo "Aborted — nothing imported."
  exit 1
fi

# WIPE_FIRST is forced off so an exported value in the shell can't leak in.
export PROJECT_NAME
echo; echo "── Safety Inductions"
WIPE_FIRST=0 ALLOW_INDUCTION_IMPORT=1 CSV_PATH="$CSV_DIR/$CSV_INDUCTIONS" \
  npx tsx scripts/import-colab-safety-inductions.ts
echo; echo "── Work Permits"
WIPE_FIRST=0 ALLOW_WORK_PERMIT_IMPORT=1 CSV_PATH="$CSV_DIR/$CSV_PERMITS" \
  npx tsx scripts/import-work-permits.ts
echo; echo "── HSE Checklists"
WIPE_FIRST=0 ALLOW_HSE_CHECKLIST_IMPORT=1 CSV_PATH="$CSV_DIR/$CSV_CHECKLISTS" \
  npx tsx scripts/import-colab-hse-checklists.ts

echo
echo "Done. Expected for the Oct 7 export: inductions created 2 / skipped 105,"
echo "permits created 16 / skipped 148, checklists created 5 / skipped 173."
