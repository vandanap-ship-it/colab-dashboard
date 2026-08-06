#!/usr/bin/env bash
# ─── Manual DB backup ───────────────────────────────────────────────────────
# Runs a pg_dump against $DATABASE_URL and, if $BLOB_READ_WRITE_TOKEN is set,
# uploads to Vercel Blob under backups/YYYY-MM/. Otherwise leaves the .sql.gz
# file in the current directory.
#
# Requires: postgresql-client (matching Neon's version 17), curl, python3.
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/backup-db.sh
#   DATABASE_URL="..." BLOB_READ_WRITE_TOKEN="vercel_blob_..." ./scripts/backup-db.sh
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ DATABASE_URL is required" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "✗ pg_dump not found. Install postgresql-client (matching version 17)." >&2
  exit 1
fi

TIMESTAMP=$(date -u +'%Y-%m-%dT%H-%M-%SZ')
FILENAME="siddhi-backup-${TIMESTAMP}.sql.gz"

echo "─── dumping to ${FILENAME} ───"
pg_dump "$DATABASE_URL" --no-owner --no-acl --format=plain | gzip -9 > "$FILENAME"

SIZE=$(du -h "$FILENAME" | cut -f1)
echo "✓ Dump complete — ${FILENAME} (${SIZE})"

if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  echo "ℹ BLOB_READ_WRITE_TOKEN not set — file left in place."
  echo "  To upload later: run again with the token, or upload manually."
  exit 0
fi

MONTH=$(date -u +'%Y-%m')
UPLOAD_PATH="backups/${MONTH}/${FILENAME}"
echo "─── uploading to Vercel Blob (${UPLOAD_PATH}) ───"

RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
  -H "authorization: Bearer $BLOB_READ_WRITE_TOKEN" \
  -H "x-content-type: application/gzip" \
  -H "x-add-random-suffix: 0" \
  --data-binary "@${FILENAME}" \
  "https://blob.vercel-storage.com/${UPLOAD_PATH}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "✗ Blob upload failed with HTTP ${HTTP_CODE}: ${BODY}" >&2
  exit 1
fi

BLOB_URL=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
echo "✓ Uploaded to: ${BLOB_URL}"
echo ""
echo "Local file: ${FILENAME}"
echo "Blob URL:   ${BLOB_URL}"
