import { prisma } from "@/lib/prisma";

/**
 * Adoption dashboard — data layer. Pulls activity signal across every
 * surface Siddhi captures, grouped three ways (by day, by module per
 * week, by user, by contractor) so the planner-side /adoption page
 * can answer "is the site team actually using this?"
 *
 * "Activity" means a row the user created on one of these surfaces:
 *
 *   ProgressEntry        Progress
 *   ManpowerEntry        Manpower
 *   Inspection           HSE Checklist (module=SAFETY) / QA/QC WIR (module=QAQC)
 *   WorkPermit           Permits
 *   SafetyInduction      Inductions
 *   Issue                Observations (module=SAFETY / QAQC / null)
 *
 * Not counted: Push notifications, approvals, status flips. Only
 * authored content — the thing adoption actually measures.
 */

export type AdoptionRange = "14d" | "30d" | "handover";

export const HANDOVER_START_ISO = "2026-09-30T00:00:00.000Z";

export function rangeStart(range: AdoptionRange, now: Date = new Date()): Date {
  if (range === "handover") return new Date(HANDOVER_START_ISO);
  const days = range === "14d" ? 14 : 30;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of the window that sits immediately before `start` and has
 *  the same length. For range="handover" the semantics are off — the
 *  "prior equivalent" would reach back into trial-period weeks where
 *  Siddhi was barely used, so loadAdoption() returns previous=null
 *  for that range and we don't render deltas. */
export function previousRangeStart(start: Date, now: Date = new Date()): Date {
  const spanMs = now.getTime() - start.getTime();
  const prior = new Date(start.getTime() - spanMs);
  prior.setUTCHours(0, 0, 0, 0);
  return prior;
}

export function rangeLabel(range: AdoptionRange): string {
  if (range === "14d") return "Last 14 days";
  if (range === "30d") return "Last 30 days";
  return "Since handover (30 Sep)";
}

/** All six surfaces, ordered for the module×week table. */
export const MODULE_KEYS = [
  "progress",
  "manpower",
  "hse",
  "permits",
  "inductions",
  "qaqc",
  "observations",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  progress: "Progress",
  manpower: "Manpower",
  hse: "HSE Checklists",
  permits: "Permits",
  inductions: "Inductions",
  qaqc: "QA/QC WIRs",
  observations: "Observations",
};

type RowSignal = {
  module: ModuleKey;
  userId: string;
  createdAt: Date;
};

/** Fetch every activity row (just id + user + created-at + module tag)
 *  across all surfaces for a project within [start, end). end defaults
 *  to open-ended so loadAdoption() can reuse this for the current
 *  window AND the prior-equivalent window. One trip per model so
 *  Prisma can plan each one properly; still a handful of indexed
 *  count-style queries, fine for the planner-side dashboard. */
async function fetchSignals(projectId: string, start: Date, end?: Date): Promise<RowSignal[]> {
  const where = {
    projectId,
    deletedAt: null,
    createdAt: end ? { gte: start, lt: end } : { gte: start },
  };

  const [
    progress,
    manpower,
    inspections,
    permits,
    inductions,
    observations,
  ] = await Promise.all([
    prisma.progressEntry.findMany({
      where,
      select: { createdById: true, createdAt: true },
    }),
    prisma.manpowerEntry.findMany({
      where,
      select: { createdById: true, createdAt: true },
    }),
    prisma.inspection.findMany({
      where,
      select: { filledById: true, module: true, createdAt: true },
    }),
    prisma.workPermit.findMany({
      where,
      select: { requesterId: true, createdAt: true },
    }),
    prisma.safetyInduction.findMany({
      where,
      select: { createdById: true, createdAt: true },
    }),
    prisma.issue.findMany({
      where,
      select: { createdById: true, module: true, createdAt: true },
    }),
  ]);

  const signals: RowSignal[] = [];
  for (const p of progress) signals.push({ module: "progress", userId: p.createdById, createdAt: p.createdAt });
  for (const m of manpower) signals.push({ module: "manpower", userId: m.createdById, createdAt: m.createdAt });
  for (const i of inspections) {
    // SAFETY-tagged inspections are HSE Checklists; QAQC-tagged ones
    // are WIRs; untagged defaults to QAQC per the module convention.
    const mod: ModuleKey = i.module === "SAFETY" ? "hse" : "qaqc";
    signals.push({ module: mod, userId: i.filledById, createdAt: i.createdAt });
  }
  for (const p of permits) signals.push({ module: "permits", userId: p.requesterId, createdAt: p.createdAt });
  for (const ind of inductions) signals.push({ module: "inductions", userId: ind.createdById, createdAt: ind.createdAt });
  for (const ob of observations) signals.push({ module: "observations", userId: ob.createdById, createdAt: ob.createdAt });

  return signals;
}

/** YYYY-MM-DD in IST so the day-buckets match what engineers see.
 *  All timestamps on the DB are UTC; +5:30 shift lands us on the
 *  right wall-clock day for a 23:30 IST entry (which would otherwise
 *  bucket as the next UTC day). */
export function istDayKey(d: Date): string {
  const ms = d.getTime() + 5.5 * 60 * 60 * 1000;
  const shifted = new Date(ms);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week key YYYY-Www. Uses IST shift so a late-Sunday entry
 *  stays in the week it feels like for site staff. */
export function istWeekKey(d: Date): string {
  const ms = d.getTime() + 5.5 * 60 * 60 * 1000;
  const t = new Date(ms);
  // ISO week calc from the shifted date; Thursday-of-the-week trick.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export type DauPoint = { day: string; users: number };

export function rollupDau(signals: RowSignal[], start: Date, now: Date): DauPoint[] {
  const perDay = new Map<string, Set<string>>();
  for (const s of signals) {
    const k = istDayKey(s.createdAt);
    if (!perDay.has(k)) perDay.set(k, new Set());
    perDay.get(k)!.add(s.userId);
  }
  // Fill the full span so missing days render as 0 bars.
  const out: DauPoint[] = [];
  const d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);
  const stop = new Date(now);
  stop.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= stop.getTime()) {
    const k = istDayKey(d);
    out.push({ day: k, users: perDay.get(k)?.size ?? 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export type WeekRow = { week: string; counts: Record<ModuleKey, number>; total: number };

export function rollupWeekByModule(signals: RowSignal[]): WeekRow[] {
  const perWeek = new Map<string, Record<ModuleKey, number>>();
  for (const s of signals) {
    const wk = istWeekKey(s.createdAt);
    if (!perWeek.has(wk)) {
      perWeek.set(
        wk,
        Object.fromEntries(MODULE_KEYS.map((m) => [m, 0])) as Record<ModuleKey, number>,
      );
    }
    perWeek.get(wk)![s.module] += 1;
  }
  const rows = Array.from(perWeek, ([week, counts]) => {
    const total = MODULE_KEYS.reduce((n, m) => n + counts[m], 0);
    return { week, counts, total };
  });
  rows.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
  return rows;
}

export type UserRow = {
  userId: string;
  name: string;
  username: string;
  role: string;
  contractorName: string | null;
  rowsLast7d: number;
  rowsInWindow: number;
  lastSeen: Date | null;
};

export async function rollupUsers(
  signals: RowSignal[],
  now: Date = new Date(),
): Promise<UserRow[]> {
  const perUser = new Map<
    string,
    { rowsLast7d: number; rowsInWindow: number; lastSeen: Date }
  >();
  const sevenDaysAgoMs = now.getTime() - 7 * 86400000;

  for (const s of signals) {
    const entry = perUser.get(s.userId) ?? {
      rowsLast7d: 0,
      rowsInWindow: 0,
      lastSeen: s.createdAt,
    };
    entry.rowsInWindow += 1;
    if (s.createdAt.getTime() >= sevenDaysAgoMs) entry.rowsLast7d += 1;
    if (s.createdAt.getTime() > entry.lastSeen.getTime()) entry.lastSeen = s.createdAt;
    perUser.set(s.userId, entry);
  }

  if (perUser.size === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(perUser.keys()) } },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      contractor: { select: { name: true } },
    },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows: UserRow[] = [];
  for (const [userId, agg] of perUser) {
    const u = userMap.get(userId);
    rows.push({
      userId,
      name: u?.name ?? "Unknown",
      username: u?.username ?? userId.slice(0, 8),
      role: u?.role ?? "—",
      contractorName: u?.contractor?.name ?? null,
      rowsLast7d: agg.rowsLast7d,
      rowsInWindow: agg.rowsInWindow,
      lastSeen: agg.lastSeen,
    });
  }
  rows.sort((a, b) => b.rowsInWindow - a.rowsInWindow || b.rowsLast7d - a.rowsLast7d);
  return rows;
}

export type ContractorRow = {
  contractorId: string;
  name: string;
  userCount: number;
  rowsInWindow: number;
};

export async function rollupContractors(
  signals: RowSignal[],
  projectId: string,
): Promise<ContractorRow[]> {
  if (signals.length === 0) return [];
  const perUser = new Map<string, number>();
  for (const s of signals) perUser.set(s.userId, (perUser.get(s.userId) ?? 0) + 1);

  // Resolve user→contractor once for every user with activity.
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(perUser.keys()) } },
    select: { id: true, contractorId: true },
  });
  const perContractor = new Map<string, { userIds: Set<string>; rows: number }>();
  for (const u of users) {
    if (!u.contractorId) continue;
    const entry = perContractor.get(u.contractorId) ?? { userIds: new Set<string>(), rows: 0 };
    entry.userIds.add(u.id);
    entry.rows += perUser.get(u.id) ?? 0;
    perContractor.set(u.contractorId, entry);
  }

  if (perContractor.size === 0) return [];

  const contractors = await prisma.contractor.findMany({
    where: { projectId, id: { in: Array.from(perContractor.keys()) } },
    select: { id: true, name: true },
  });
  const rows = contractors.map((c) => {
    const agg = perContractor.get(c.id)!;
    return {
      contractorId: c.id,
      name: c.name,
      userCount: agg.userIds.size,
      rowsInWindow: agg.rows,
    };
  });
  rows.sort((a, b) => b.rowsInWindow - a.rowsInWindow);
  return rows;
}

/** Prior-window counts, keyed for a fast delta render on the page.
 *  Null when the current range is "handover" — the "equivalent prior"
 *  would reach back into Siddhi's trial weeks where almost nothing
 *  was raised and the delta reads as misleadingly huge. */
export type PreviousWindow = {
  start: Date;
  end: Date;
  totalRows: number;
  totalActiveUsers: number;
  rowsByUser: Record<string, number>; // keyed by userId
  rowsByContractor: Record<string, number>; // keyed by contractorId
};

export type AdoptionData = {
  range: AdoptionRange;
  start: Date;
  now: Date;
  dau: DauPoint[];
  weeks: WeekRow[];
  users: UserRow[];
  contractors: ContractorRow[];
  totalRows: number;
  totalActiveUsers: number;
  previous: PreviousWindow | null;
};

async function buildPreviousWindow(
  projectId: string,
  start: Date,
  end: Date,
): Promise<PreviousWindow> {
  const signals = await fetchSignals(projectId, start, end);
  const rowsByUser: Record<string, number> = {};
  for (const s of signals) rowsByUser[s.userId] = (rowsByUser[s.userId] ?? 0) + 1;

  // Resolve each active user's contractor so prior-window contractor
  // totals line up with the current-window table even when a user
  // was tagged to a different contractor at the time (we take
  // today's tag — close enough; retagging mid-window is rare).
  const rowsByContractor: Record<string, number> = {};
  const userIds = Object.keys(rowsByUser);
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, contractorId: true },
    });
    for (const u of users) {
      if (!u.contractorId) continue;
      rowsByContractor[u.contractorId] =
        (rowsByContractor[u.contractorId] ?? 0) + (rowsByUser[u.id] ?? 0);
    }
  }

  return {
    start,
    end,
    totalRows: signals.length,
    totalActiveUsers: new Set(signals.map((s) => s.userId)).size,
    rowsByUser,
    rowsByContractor,
  };
}

export async function loadAdoption(projectId: string, range: AdoptionRange): Promise<AdoptionData> {
  const now = new Date();
  const start = rangeStart(range, now);
  const [signals, previous] = await Promise.all([
    fetchSignals(projectId, start),
    range === "handover"
      ? Promise.resolve(null as PreviousWindow | null)
      : buildPreviousWindow(projectId, previousRangeStart(start, now), start),
  ]);
  const [users, contractors] = await Promise.all([
    rollupUsers(signals, now),
    rollupContractors(signals, projectId),
  ]);
  return {
    range,
    start,
    now,
    dau: rollupDau(signals, start, now),
    weeks: rollupWeekByModule(signals),
    users,
    contractors,
    totalRows: signals.length,
    totalActiveUsers: new Set(signals.map((s) => s.userId)).size,
    previous,
  };
}
