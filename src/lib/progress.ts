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

/**
 * Colab-parity monotonic guard message. Shraddha 2026-09-30 confirmed
 * progress-only-goes-up as an intentional Siddhi rule (matching Colab's
 * Edit Progress slider that min-locks to the current cumulative).
 *
 * `context` names where the check fired so the message reads naturally
 * for both the fresh-POST path ("new entry must be ≥ that") and the
 * publish-a-draft path ("this draft must be ≥ that").
 */
export function monotonicViolationMessage(
  priorMax: number,
  context: "new" | "draft",
): string {
  const noun = context === "new" ? "new entry" : "this draft";
  return `Progress can't go backwards. Latest logged is ${priorMax.toFixed(1)} — ${noun} must be ≥ that. To correct an over-count, ask an admin to void the wrong row.`;
}
