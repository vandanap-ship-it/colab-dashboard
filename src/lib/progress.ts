/**
 * Colab-parity human-readable ProgressEntry id shown on Site Progress
 * activity cards (Madhavan zip 2026-09-30 · "ID : PROG435527" chip).
 * 8-char uppercase-alphanumeric using an unambiguous alphabet so a
 * paper printout or a WhatsApp screenshot can be read back reliably
 * (no I/O/0/1 which confuse in most fonts).
 *
 * Uniqueness is enforced by the DB (unique-ish via the index; format
 * collision is astronomically low for the White Lotus scale). If a
 * collision ever occurs, the API surfaces the underlying error and the
 * caller retries with a fresh id.
 */
export function generateProgressDisplayId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "PROG-";
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// monotonicViolationMessage removed 2026-10-07 (Vandana). The
// progress-only-goes-up rule has been replaced with a reduction-
// requires-note rule across the POST, PATCH and publish paths; each
// one spells out the user-facing message inline (short enough that
// a shared helper buys nothing). Historical commits show the old
// shape if ever needed back.
