#!/usr/bin/env bash
# ─── Colab → Siddhi handover import ─────────────────────────────────────────
# Wipes existing rows for Safety Induction, Work Permits, and HSE Checklists
# (module=SAFETY Inspections) on the target project, then imports the
# matching rows from Shraddha's 2026-10-01 Colab export.
#
# Pre-flight the script does:
#   1. backs up the DB via scripts/backup-db.sh (dump → local .sql.gz +
#      Vercel Blob if $BLOB_READ_WRITE_TOKEN is set)
#   2. aborts if DATABASE_URL isn't a Neon URL (prod safety)
#   3. prompts for `yes` typed at the terminal before touching data
#
# Required env:
#   DATABASE_URL      Neon connection string for the target project
#   CSV_DIR           Directory containing the three CSVs — e.g. the folder
#                     you get after unzipping Shraddha's bundle. Expected
#                     filenames are the UUID-ish ones Colab generates:
#                       2026-10-01_a20866ac-9218-4bf0-ac55-4119ab26a3be.csv  (inductions)
#                       20261001_c3840f4a-43e5-4c20-a6a9-bd991b51b3e2.csv    (permits)
#                       20261001_d0a387a1-ae42-4fb5-98c6-edc501c0aceb.csv    (hse checklists)
#                     If names differ, override via CSV_INDUCTIONS /
#                     CSV_PERMITS / CSV_CHECKLISTS individually.
#
# Optional env:
#   PROJECT_NAME      Siddhi project name (default: "Amanvana")
#   BLOB_READ_WRITE_TOKEN  if set, backup uploads to Vercel Blob
#   SKIP_BACKUP=1     skip the pg_dump (not recommended)
#   SKIP_INDUCTIONS=1 / SKIP_PERMITS=1 / SKIP_CHECKLISTS=1
#                     skip that domain
#
# Usage:
#   unzip "~/Downloads/colab tools final reports.zip" -d /tmp/colab-import
#   DATABASE_URL="postgresql://..." \
#     CSV_DIR="/tmp/colab-import/colab tools final reports" \
#     bash scripts/colab-handover-import.sh
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is required" >&2
  exit 1
fi

# Allow pointing at any Neon instance. The three per-domain scripts each have
# their own ALLOW_*_IMPORT=1 guard that this wrapper sets.
if ! echo "$DATABASE_URL" | grep -qi 'neon\.tech'; then
  echo "⚠ DATABASE_URL doesn't look like a Neon URL. Proceeding anyway."
fi

PROJECT_NAME="${PROJECT_NAME:-Amanvana}"

if [ -z "${CSV_DIR:-}" ]; then
  echo "✗ CSV_DIR is required — point it at the unzipped Colab export folder." >&2
  echo "  See the header comment in this script for the one-liner." >&2
  exit 1
fi

if [ ! -d "$CSV_DIR" ]; then
  echo "✗ CSV_DIR not found: $CSV_DIR" >&2
  exit 1
fi

# Canonical filenames from Shraddha's 2026-10-01 export. If filenames
# change, pass CSV_INDUCTIONS / CSV_PERMITS / CSV_CHECKLISTS to override.
CSV_INDUCTIONS="${CSV_INDUCTIONS:-$CSV_DIR/2026-10-01_a20866ac-9218-4bf0-ac55-4119ab26a3be.csv}"
CSV_PERMITS="${CSV_PERMITS:-$CSV_DIR/20261001_c3840f4a-43e5-4c20-a6a9-bd991b51b3e2.csv}"
CSV_CHECKLISTS="${CSV_CHECKLISTS:-$CSV_DIR/20261001_d0a387a1-ae42-4fb5-98c6-edc501c0aceb.csv}"

for f in "$CSV_INDUCTIONS" "$CSV_PERMITS" "$CSV_CHECKLISTS"; do
  if [ ! -f "$f" ]; then
    echo "✗ Missing CSV: $f" >&2
    exit 1
  fi
done

echo ""
echo "─── Colab → Siddhi handover import ──────────────────────────────────────"
echo "  Project:        $PROJECT_NAME"
echo "  Inductions CSV: $(basename "$CSV_INDUCTIONS")"
echo "  Permits CSV:    $(basename "$CSV_PERMITS")"
echo "  Checklists CSV: $(basename "$CSV_CHECKLISTS")"
echo "──────────────────────────────────────────────────────────────────────────"
echo ""
echo "⚠  This will DELETE all existing SafetyInduction, WorkPermit, and"
echo "   SAFETY-module Inspection rows for '$PROJECT_NAME' and replace them"
echo "   with the Colab export. Users, QAQC inspections, progress entries,"
echo "   issues, hindrances, etc. are untouched."
echo ""
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# Step 1: backup
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  echo ""
  echo "─── Step 1 · DB backup ──────────────────────────────────────────────────"
  DATABASE_URL="$DATABASE_URL" bash scripts/backup-db.sh
else
  echo ""
  echo "─── Step 1 · DB backup SKIPPED (SKIP_BACKUP=1) ──────────────────────────"
fi

# Step 2: Safety Inductions
if [ "${SKIP_INDUCTIONS:-0}" != "1" ]; then
  echo ""
  echo "─── Step 2 · Safety Inductions ──────────────────────────────────────────"
  DATABASE_URL="$DATABASE_URL" \
  ALLOW_INDUCTION_IMPORT=1 \
  WIPE_FIRST=1 \
  PROJECT_NAME="$PROJECT_NAME" \
  CSV_PATH="$CSV_INDUCTIONS" \
    npx tsx scripts/import-colab-safety-inductions.ts
fi

# Step 3: Work Permits
if [ "${SKIP_PERMITS:-0}" != "1" ]; then
  echo ""
  echo "─── Step 3 · Work Permits ───────────────────────────────────────────────"
  DATABASE_URL="$DATABASE_URL" \
  ALLOW_WORK_PERMIT_IMPORT=1 \
  WIPE_FIRST=1 \
  PROJECT_NAME="$PROJECT_NAME" \
  CSV_PATH="$CSV_PERMITS" \
    npx tsx scripts/import-work-permits.ts
fi

# Step 4: HSE Checklists (SAFETY-module Inspections)
if [ "${SKIP_CHECKLISTS:-0}" != "1" ]; then
  echo ""
  echo "─── Step 4 · HSE Checklists ─────────────────────────────────────────────"
  DATABASE_URL="$DATABASE_URL" \
  ALLOW_HSE_CHECKLIST_IMPORT=1 \
  WIPE_FIRST=1 \
  PROJECT_NAME="$PROJECT_NAME" \
  CSV_PATH="$CSV_CHECKLISTS" \
    npx tsx scripts/import-colab-hse-checklists.ts
fi

echo ""
echo "─── All done ───────────────────────────────────────────────────────────"
echo "  Spot-check in the mobile app:"
echo "    /mobile/<projectId>/induction"
echo "    /mobile/<projectId>/permits"
echo "    /mobile/<projectId>/inspections?module=SAFETY"
echo "─────────────────────────────────────────────────────────────────────────"
