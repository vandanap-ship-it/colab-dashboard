/**
 * Colab-parity permit checklist helpers.
 *
 * The permit's Step-3 checklist is stored as a `Json` column on
 * `WorkPermit.checklistResponses`. It's an array of row objects that
 * both the mobile detail page and the reviewer PATCH endpoint need to
 * read and re-serialize. Kept here as pure functions so:
 *   - the detail page can narrow raw Prisma JSON at read time
 *   - the PATCH endpoint can merge a reviewer's reply without losing
 *     the raiser's fields
 *   - both sites share ONE shape so a future field addition doesn't
 *     require touching two places
 *
 * `q` mirrors the template question at capture time so an audit reader
 * can trace what was asked even if the template later changes. The
 * `reviewer*` fields are populated via PATCH
 * /api/work-permits/[id]/checkpoints; they stay null on a freshly
 * raised permit.
 */

export type StoredCheckpoint = {
  q: string;
  passed: boolean | null;
  remark?: string;
  photoUrl?: string;
  reviewerNote?: string | null;
  reviewerPhotoUrl?: string | null;
};

/**
 * Coerce raw Prisma JSON into a well-formed StoredCheckpoint[]. Silently
 * drops any row that isn't a plain object with a string `q` — a
 * corrupted JSONB payload should never crash a page or an authorization
 * check downstream. Malformed rows are treated the same as absent.
 */
export function narrowCheckpoints(v: unknown): StoredCheckpoint[] {
  if (!Array.isArray(v)) return [];
  const out: StoredCheckpoint[] = [];
  for (const row of v) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).q === "string") {
      const r = row as Record<string, unknown>;
      out.push({
        q: r.q as string,
        passed: typeof r.passed === "boolean" ? (r.passed as boolean) : null,
        remark: typeof r.remark === "string" ? (r.remark as string) : undefined,
        photoUrl: typeof r.photoUrl === "string" ? (r.photoUrl as string) : undefined,
        reviewerNote:
          typeof r.reviewerNote === "string" ? (r.reviewerNote as string) : null,
        reviewerPhotoUrl:
          typeof r.reviewerPhotoUrl === "string" ? (r.reviewerPhotoUrl as string) : null,
      });
    }
  }
  return out;
}

/**
 * Merge a reviewer's reply (note / photo) into row `index`, preserving
 * the raiser's fields (`q`, `passed`, `remark`, `photoUrl`). `undefined`
 * on either patch key means "don't touch"; `null` means "clear". Returns
 * a new array; the input is not mutated.
 *
 * Returns null when the index is out of range so the caller can 400 on
 * a bad checkpoint id instead of silently no-op'ing.
 */
export function applyReviewerReply(
  rows: StoredCheckpoint[],
  index: number,
  patch: { reviewerNote?: string | null; reviewerPhotoUrl?: string | null },
): StoredCheckpoint[] | null {
  if (index < 0 || index >= rows.length) return null;
  const target = rows[index];
  const next: StoredCheckpoint = {
    ...target,
    reviewerNote:
      patch.reviewerNote === undefined
        ? target.reviewerNote ?? null
        : patch.reviewerNote?.trim() || null,
    reviewerPhotoUrl:
      patch.reviewerPhotoUrl === undefined
        ? target.reviewerPhotoUrl ?? null
        : patch.reviewerPhotoUrl || null,
  };
  const nextRows = rows.slice();
  nextRows[index] = next;
  return nextRows;
}
