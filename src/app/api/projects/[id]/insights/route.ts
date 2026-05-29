import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";

export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/insights">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Insights aggregate progress/schedule data (PROGRESS module) — keep them
  // out of scoped contractors' reach, same as the schedule itself.
  if (!canAccessModule(session.user.modules, MODULES.PROGRESS)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30", 10) || 30, 7), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  // Pull progress entries with labour
  const entries = await prisma.progressEntry.findMany({
    where: { projectId, date: { gte: since } },
    select: {
      date: true,
      achievedQuantity: true,
      cumulativeQuantity: true,
      labour: { select: { count: true } },
    },
  });

  // Pull hindrances within window
  const hindrances = await prisma.hindrance.findMany({
    where: { projectId, OR: [{ startDate: { gte: since } }, { resolvedDate: { gte: since } }] },
    select: { startDate: true, resolvedDate: true, status: true },
  });

  // Build day buckets
  const buckets: { day: string; achieved: number; labour: number; hindranceOpen: number; hindranceResolved: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ day: key, achieved: 0, labour: 0, hindranceOpen: 0, hindranceResolved: 0 });
  }
  const idx = new Map<string, number>(buckets.map((b, i) => [b.day, i]));

  for (const e of entries) {
    const k = e.date.toISOString().slice(0, 10);
    const i = idx.get(k);
    if (i == null) continue;
    buckets[i].achieved += e.achievedQuantity;
    buckets[i].labour += e.labour.reduce((s, l) => s + l.count, 0);
  }
  for (const h of hindrances) {
    const sk = h.startDate.toISOString().slice(0, 10);
    const i = idx.get(sk);
    if (i != null) buckets[i].hindranceOpen += 1;
    if (h.resolvedDate) {
      const rk = h.resolvedDate.toISOString().slice(0, 10);
      const j = idx.get(rk);
      if (j != null) buckets[j].hindranceResolved += 1;
    }
  }

  // Totals
  const totals = {
    achievedSum: entries.reduce((s, e) => s + e.achievedQuantity, 0),
    labourSum: entries.reduce((s, e) => s + e.labour.reduce((x, l) => x + l.count, 0), 0),
    progressEntries: entries.length,
    hindrancesOpened: hindrances.length,
    hindrancesResolved: hindrances.filter((h) => !!h.resolvedDate).length,
  };

  return NextResponse.json({ days, since: since.toISOString(), buckets, totals });
}
