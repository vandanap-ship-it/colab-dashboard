import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Colab-parity "In Quality" bucket for the Site Progress list. Returns
 * `{ blockedVillaIds: string[] }` — every villa on this project that has
 * at least one WBS activity currently blocked by a pending QAQC
 * checklist.
 *
 * ---------------------------------------------------------------------
 * GATE DISABLED 2026-10-07 (matches src/lib/progressGates.ts):
 *
 * The QA/QC team isn't using Siddhi yet, so no villa has PASSED
 * inspections, so without this early-return every villa with a gated
 * activity (Concreting, Plastering, etc.) would show up here as "In
 * Quality". That gave Harish 87 villas to look at that weren't really
 * blocked by anything actionable. The real `checkPrecheck` now returns
 * ok unconditionally, so this endpoint matches.
 *
 * To re-enable: restore the activity + inspection walk below (preserved
 * in git history, commit before this change). The PROGRESS_GATES
 * registry is intact; nothing else needs restoring.
 * ---------------------------------------------------------------------
 */
export async function GET(
  _req: Request,
  _params: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ blockedVillaIds: [] });
}
