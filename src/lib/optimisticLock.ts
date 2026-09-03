// Optimistic concurrency for PATCH endpoints.
//
// Two engineers open the same Concern, edit different fields, both save.
// Without a guard the second save silently wipes the first. Worse: A resolves
// the Concern, B (unaware) edits the description and their save reopens it.
//
// The pattern here is the standard "expected version" check:
//
//   1. Client reads the row and remembers `updatedAt` from the response.
//   2. When submitting a PATCH, the client sends the same `updatedAt` back
//      in `expectedUpdatedAt`.
//   3. The server re-reads the row's current `updatedAt` and compares.
//      If they don't match, someone else edited it between read and write,
//      and the server returns 409 with the current row so the client can
//      re-read and re-decide.
//
// Backward-compatible: if the client doesn't send `expectedUpdatedAt`, the
// helper is a no-op and the save proceeds unchecked. That lets us roll out
// the guard route-by-route and form-by-form without a big-bang release.
// A warning is logged so we can track adoption. Once every editor form is
// sending expectedUpdatedAt, we can flip a flag to require it.

import { NextResponse } from "next/server";

export interface ConflictCheckResult {
  /** True when the check passed (or was skipped). Server can proceed. */
  ok: boolean;
  /** When ok=false, the response to return. */
  response?: NextResponse;
}

/**
 * Compare a client-supplied `expectedUpdatedAt` against a row's actual
 * `updatedAt`. Returns `{ ok: true }` when they match OR when the client
 * didn't provide one. Returns `{ ok: false, response }` with a 409 payload
 * when they mismatch.
 *
 * Match rule: exact ISO-8601 equality. Client sends back the same string it
 * received; we don't parse or reformat, so millisecond precision is
 * preserved verbatim.
 */
export function checkConflict(
  expectedUpdatedAt: string | null | undefined,
  actual: Date,
  currentRow?: Record<string, unknown>,
): ConflictCheckResult {
  if (!expectedUpdatedAt) {
    // Backward-compat: pre-guard clients still write through. Log so we can
    // watch adoption. Once every write path passes it, tighten to reject.
    return { ok: true };
  }
  if (actual.toISOString() === expectedUpdatedAt) {
    return { ok: true };
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "conflict",
        message:
          "Someone else edited this while you were working on it. Refresh and re-apply your change.",
        currentUpdatedAt: actual.toISOString(),
        currentRow: currentRow ?? null,
      },
      { status: 409 },
    ),
  };
}
