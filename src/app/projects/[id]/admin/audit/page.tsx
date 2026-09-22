import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Filter as FilterIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { isAdmin, canSeeDesktop, ROLES } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";

export const dynamic = "force-dynamic";

/**
 * Audit log viewer — every mutation via recordAudit() shows up here.
 * Admin-only (and, when we grow, planners who need to trace a change).
 * The page is server-rendered and URL-driven so a link to a specific
 * filter set is copy-paste-safe: /admin/audit?entityType=Issue&actor=jane
 *
 * Filters (all optional):
 *   - entityType   → 17 supported types (see src/lib/audit.ts)
 *   - action       → CREATE / UPDATE / DELETE / RESTORE / STATUS_CHANGE / UPSERT
 *   - actorId      → dropdown of users active on the project
 *   - from / to    → date range on createdAt
 *   - page         → 1-indexed pagination (50 rows/page)
 *
 * Column layout mirrors "who did what to what, when":
 *   Time  ·  Actor  ·  Action  ·  Entity  ·  Summary
 */

const ENTITY_TYPES = [
  "ProgressEntry",
  "Issue",
  "Hindrance",
  "Concern",
  "Inspection",
  "Project",
  "ProjectDrawing",
  "User",
  "Contractor",
  "WBSNode",
  "SubContractorBill",
  "Expense",
  "DesignDrawing",
  "Rfi",
  "Permit",
  "WorkPermit",
  "TradePlan",
  "ManpowerEntry",
] as const;

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "RESTORE", "STATUS_CHANGE", "UPSERT"] as const;

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    entityType?: string;
    action?: string;
    actorId?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  if (isScopedUser(session.user.modules)) redirect("/mobile");
  if (!(isAdmin(session.user.role) || session.user.role === ROLES.PLANNER)) {
    redirect(`/projects/${(await params).id}`);
  }

  const { id: projectId } = await params;
  const sp = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  // Normalise filters.
  const entityType = ENTITY_TYPES.includes((sp.entityType ?? "") as (typeof ENTITY_TYPES)[number])
    ? (sp.entityType as string)
    : null;
  const action = ACTIONS.includes((sp.action ?? "") as (typeof ACTIONS)[number])
    ? (sp.action as string)
    : null;
  const actorId = sp.actorId && sp.actorId.length > 0 ? sp.actorId : null;
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // Build where clause piece by piece so an unset filter maps to "no
  // filter", not "match null".
  const where: {
    projectId: string;
    entityType?: string;
    action?: string;
    userId?: string;
    createdAt?: { gte?: Date; lt?: Date };
  } = { projectId };
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (actorId) where.userId = actorId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) {
      const toExclusive = new Date(to);
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
      where.createdAt.lt = toExclusive;
    }
  }

  // Actor dropdown — only users who've actually written an audit for this
  // project, so the picker isn't cluttered with unrelated staff. AuditLog
  // has no navigational relation to User, so pull distinct userIds first
  // and then hydrate the names in a second query.
  const [rows, total, distinctActors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { projectId },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  const actorRows = await prisma.user.findMany({
    where: { id: { in: distinctActors.map((a) => a.userId) }, active: true },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });

  const actorNameById = new Map(actorRows.map((u) => [u.id, u.name]));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reused helper: build a URL that preserves the current filter set but
  // overrides one param at a time. Rendered on every filter chip + the
  // pagination arrows.
  function withParam(key: string, value: string | null): string {
    const q = new URLSearchParams();
    if (entityType) q.set("entityType", entityType);
    if (action) q.set("action", action);
    if (actorId) q.set("actorId", actorId);
    if (from) q.set("from", isoDate(from));
    if (to) q.set("to", isoDate(to));
    if (value === null) q.delete(key);
    else q.set(key, value);
    // Reset to page 1 on any filter change (but not on page moves).
    if (key !== "page") q.delete("page");
    else q.set(key, value ?? "1");
    const s = q.toString();
    return `/projects/${projectId}/admin/audit${s ? `?${s}` : ""}`;
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-stone-50">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <div>
            <Link
              href={`/projects/${projectId}`}
              className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {project.name}
            </Link>
            <div className="flex items-baseline gap-3 mt-1">
              <h1 className="text-2xl font-semibold text-stone-900">Audit log</h1>
              <span className="text-sm text-stone-500 tabular-nums">
                {total.toLocaleString()} record{total === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm text-stone-500 mt-1">
              Every meaningful mutation lands here — who changed what, when.
            </p>
          </div>

          {/* Filters — GET form so each filter change survives a back /
              refresh via the URL, and the state is self-documenting. */}
          <form
            method="GET"
            className="rounded-xl border border-stone-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-5 gap-3"
          >
            <label className="text-xs">
              <span className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Entity</span>
              <select
                name="entityType"
                defaultValue={entityType ?? ""}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Action</span>
              <select
                name="action"
                defaultValue={action ?? ""}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any</option>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Actor</span>
              <select
                name="actorId"
                defaultValue={actorId ?? ""}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Any</option>
                {actorRows.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">From</span>
              <input
                type="date"
                name="from"
                defaultValue={from ? isoDate(from) : ""}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">To</span>
              <input
                type="date"
                name="to"
                defaultValue={to ? isoDate(to) : ""}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <div className="sm:col-span-5 flex items-center justify-end gap-2 pt-1">
              <Link
                href={`/projects/${projectId}/admin/audit`}
                className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2"
              >
                Reset
              </Link>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 text-white text-xs font-semibold px-3 py-1.5"
              >
                <FilterIcon className="w-3.5 h-3.5" />
                Apply
              </button>
            </div>
          </form>

          {/* Rows */}
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead className="bg-stone-50">
                  <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                    <th className="text-left font-medium py-2 px-3">Time</th>
                    <th className="text-left font-medium py-2 px-3">Actor</th>
                    <th className="text-left font-medium py-2 px-3">Action</th>
                    <th className="text-left font-medium py-2 px-3">Entity</th>
                    <th className="text-left font-medium py-2 px-3">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-stone-500">
                        No audit records match these filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id} className="border-t border-stone-100 align-top">
                        <td className="py-2 px-3 text-stone-500 whitespace-nowrap tabular-nums">
                          {fmtDateTime(r.createdAt)}
                        </td>
                        <td className="py-2 px-3 text-stone-700">
                          {actorNameById.get(r.userId) ?? "—"}
                        </td>
                        <td className="py-2 px-3">
                          <ActionBadge action={r.action} />
                        </td>
                        <td className="py-2 px-3 text-stone-700 whitespace-nowrap">
                          <span className="font-mono text-[11px]">{r.entityType}</span>
                        </td>
                        <td className="py-2 px-3 text-stone-700 leading-snug max-w-[420px]">
                          {r.summary || <span className="text-stone-400 italic">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-stone-600">
              <span className="tabular-nums">
                Page {page} of {totalPages} · {total.toLocaleString()} record{total === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={withParam("page", String(page - 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    Prev
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-400">
                    Prev
                  </span>
                )}
                {page < totalPages ? (
                  <Link
                    href={withParam("page", String(page + 1))}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-400">
                    Next
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    CREATE: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800" },
    UPDATE: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700" },
    DELETE: { bg: "bg-red-50 ring-red-200", fg: "text-red-800" },
    RESTORE: { bg: "bg-blue-50 ring-blue-200", fg: "text-blue-800" },
    STATUS_CHANGE: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800" },
    UPSERT: { bg: "bg-purple-50 ring-purple-200", fg: "text-purple-800" },
  };
  const cfg = map[action] ?? { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700" };
  return (
    <span className={`inline-flex items-center rounded ring-1 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${cfg.bg} ${cfg.fg}`}>
      {action}
    </span>
  );
}

function parseDate(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
