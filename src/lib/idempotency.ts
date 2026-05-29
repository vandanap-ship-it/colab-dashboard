/**
 * Idempotency for offline-queue replays.
 *
 * Site phones generate a stable key per submission and reuse it for the direct
 * POST and every queued retry (see offlineQueue + the mobile forms). If the
 * server commits a write but the response is lost on flaky signal, the replay
 * carries the same key — so we return the already-created record instead of
 * inserting a duplicate row.
 */

/** Pull a sane idempotency key out of a request body, or null if absent. */
export function readIdempotencyKey(body: unknown): string | null {
  const raw = (body as { idempotencyKey?: unknown } | null | undefined)?.idempotencyKey;
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return k.length > 0 && k.length <= 100 ? k : null;
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

/**
 * Create a record idempotently. If `key` was already used, return the existing
 * record instead of creating a duplicate. This covers both the common case (the
 * upfront lookup finds the prior write) and a concurrent race (the unique
 * constraint fires P2002, then we look it up). `findExisting` looks the record
 * up by its key; it is only invoked when `key` is non-null.
 */
export async function createIdempotent<T>(
  key: string | null,
  findExisting: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<{ record: T; duplicate: boolean }> {
  if (key) {
    const existing = await findExisting();
    if (existing) return { record: existing, duplicate: true };
  }
  try {
    return { record: await create(), duplicate: false };
  } catch (e) {
    if (key && isUniqueViolation(e)) {
      const existing = await findExisting();
      if (existing) return { record: existing, duplicate: true };
    }
    throw e;
  }
}
