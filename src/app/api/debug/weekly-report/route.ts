// Temporary diagnostic route to isolate the Weekly Report 500. Admin only.
// Returns the raw JSON that the client component gets, so we can eyeball
// which field is malformed instead of guessing from a client-side SSR crash.
// Remove after Weekly Report is fixed.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { getWeeklyReport } from "@/lib/weeklyReportServer";
import { istDayStart } from "@/lib/istDay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const qsWeek = searchParams.get("weekEnding");
  const weekEnd = (() => {
    if (qsWeek) {
      const d = new Date(qsWeek + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d;
    }
    const t = istDayStart();
    const dow = t.getUTCDay();
    if (dow !== 0) t.setUTCDate(t.getUTCDate() - dow);
    return t;
  })();

  try {
    const report = await getWeeklyReport(projectId, weekEnd);
    if (!report) return NextResponse.json({ ok: true, report: null, note: "getWeeklyReport returned null" });
    // Shape summary so the JSON stays small
    const summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(report as unknown as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        summary[k] = { type: "array", length: v.length, sample: v[0] ?? null };
      } else if (v instanceof Date) {
        summary[k] = { type: "Date", iso: v.toISOString() };
      } else if (v && typeof v === "object") {
        summary[k] = { type: "object", keys: Object.keys(v as Record<string, unknown>) };
      } else {
        summary[k] = { type: typeof v, value: v };
      }
    }
    return NextResponse.json({ ok: true, weekEnd: weekEnd.toISOString(), summary });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 15) : null,
      weekEnd: weekEnd.toISOString(),
    }, { status: 200 });
  }
}
