import Link from "next/link";
import { prisma } from "@/lib/prisma";
import FilterSelect from "./FilterSelect";

// Force dynamic rendering — every page load filters audit entries by the
// caller's role + chosen filters, so there is nothing meaningful to cache at
// build time. Equally important: pre-rendering opens a Postgres connection
// from the Vercel build sandbox, which can exceed the 60s static-gen budget
// (see /admin/trash for the same fix).
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  entityType?: string;
  action?: string;
  userId?: string;
  projectId?: string;
  limit?: string;
}>;

// Keep this list in sync with AuditEntityType in src/lib/audit.ts. When a new
// entity type gets audited, it needs to appear here or admins can't filter by
// it — the audit log page will still show the row (the filter is optional),
// but the chip is missing from the filter bar.
const ENTITY_TYPES = [
  "ProgressEntry",
  "Issue",
  "Hindrance",
  "Concern",
  "Inspection",
  "Rfi",
  "Permit",
  "ManpowerEntry",
  "TradePlan",
  "SubContractorBill",
  "Expense",
  "Project",
  "ProjectDrawing",
  "DesignDrawing",
  "WBSNode",
  "User",
  "Contractor",
] as const;

// Also mirrors AuditAction in src/lib/audit.ts.
const ACTIONS = ["CREATE", "UPDATE", "UPSERT", "DELETE", "RESTORE", "STATUS_CHANGE"] as const;

function fmtDate(d: Date): string {
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionStyle(action: string): string {
  if (action === "CREATE") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (action === "DELETE") return "bg-red-50 text-red-700 border-red-200";
  if (action === "STATUS_CHANGE") return "bg-amber-50 text-amber-700 border-amber-200";
  if (action === "RESTORE") return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-stone-50 text-stone-700 border-stone-200";
}

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const limit = Math.min(Math.max(parseInt(sp.limit ?? "100", 10) || 100, 10), 500);

  const where: {
    entityType?: string;
    action?: string;
    userId?: string;
    projectId?: string;
  } = {};
  if (sp.entityType) where.entityType = sp.entityType;
  if (sp.action) where.action = sp.action;
  if (sp.userId) where.userId = sp.userId;
  if (sp.projectId) where.projectId = sp.projectId;

  // Load logs + look up the actors and projects in batches.
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const userIds = Array.from(new Set(logs.map((l) => l.userId)));
  const projectIds = Array.from(
    new Set(logs.map((l) => l.projectId).filter((p): p is string => !!p)),
  );

  const [users, projects, allUsers, allProjects] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, username: true },
        })
      : Promise.resolve([]),
    projectIds.length > 0
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      select: { id: true, name: true, username: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  function filterLink(patch: Partial<typeof sp>): string {
    const next = { ...sp, ...patch } as Record<string, string | undefined>;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v) qs.set(k, v);
    }
    return qs.toString() ? `/admin/audit?${qs.toString()}` : "/admin/audit";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Audit Log</h1>
          <p className="text-sm text-stone-500 mt-1">
            Every create, update, and delete across the system. Newest first.
          </p>
        </div>
        <div className="text-xs text-stone-500">
          Showing latest <span className="font-medium text-stone-900">{logs.length}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white border border-stone-200 rounded-lg p-4">
        <FilterChip
          label="All"
          href="/admin/audit"
          active={!sp.entityType && !sp.action && !sp.userId && !sp.projectId}
        />
        <span className="text-stone-300">·</span>
        <span className="text-[10px] uppercase tracking-wider text-stone-500">Entity</span>
        {ENTITY_TYPES.map((e) => (
          <FilterChip
            key={e}
            label={e}
            href={filterLink({ entityType: sp.entityType === e ? undefined : e })}
            active={sp.entityType === e}
          />
        ))}
        <span className="text-stone-300 w-full sm:w-auto">·</span>
        <span className="text-[10px] uppercase tracking-wider text-stone-500">Action</span>
        {ACTIONS.map((a) => (
          <FilterChip
            key={a}
            label={a}
            href={filterLink({ action: sp.action === a ? undefined : a })}
            active={sp.action === a}
          />
        ))}
        {(allProjects.length > 0 || allUsers.length > 0) && (
          <>
            <span className="text-stone-300 w-full sm:w-auto">·</span>
            {allProjects.length > 0 && (
              <FilterSelect
                paramKey="projectId"
                currentValue={sp.projectId}
                allLabel="All projects"
                options={allProjects.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
            {allUsers.length > 0 && (
              <FilterSelect
                paramKey="userId"
                currentValue={sp.userId}
                allLabel="All users"
                options={allUsers.map((u) => ({
                  value: u.id,
                  label: `${u.name} (@${u.username})`,
                }))}
              />
            )}
          </>
        )}
      </div>

      {/* Log table */}
      {logs.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-lg p-10 text-center text-sm text-stone-500">
          No audit entries match the current filters.
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr className="text-xs uppercase tracking-wider text-stone-500 text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const user = userById.get(log.userId);
                const project = log.projectId ? projectById.get(log.projectId) : null;
                return (
                  <tr key={log.id} className="border-b border-stone-100 last:border-b-0">
                    <td className="px-3 py-2 text-stone-600 whitespace-nowrap text-xs">
                      {fmtDate(log.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-stone-900 whitespace-nowrap">
                      {user ? user.name : <span className="text-stone-400">deleted user</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${actionStyle(
                          log.action,
                        )}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{log.entityType}</td>
                    <td className="px-3 py-2 text-stone-600 whitespace-nowrap text-xs">
                      {project ? project.name : <span className="text-stone-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-stone-700">
                      {log.summary ?? <span className="text-stone-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Limit picker */}
      <div className="flex items-center gap-3 text-xs text-stone-500">
        Show
        {[100, 200, 500].map((n) => (
          <Link
            key={n}
            href={filterLink({ limit: String(n) })}
            className={`px-2 py-1 rounded-md border ${
              limit === n
                ? "border-stone-900 text-stone-900 font-medium"
                : "border-stone-200 hover:border-stone-400"
            }`}
          >
            {n}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-xs px-2 py-1 rounded-md border ${
        active
          ? "bg-stone-900 text-white border-stone-900"
          : "bg-white text-stone-700 border-stone-200 hover:border-stone-400"
      }`}
    >
      {label}
    </Link>
  );
}
