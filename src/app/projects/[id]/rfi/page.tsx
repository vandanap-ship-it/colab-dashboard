import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, MessageSquare, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import Navbar from "@/components/Navbar";
import {
  RFI_CATEGORY_LABELS,
  RFI_PRIORITY_LABELS,
  RFI_STATUS_LABELS,
  formatRfiNumber,
  type RfiCategory,
  type RfiPriority,
  type RfiStatus,
} from "@/lib/rfi";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<RfiStatus, { bg: string; fg: string }> = {
  OPEN: { bg: "#F7EAD5", fg: "#C77A2A" },
  ANSWERED: { bg: "#E9F0F7", fg: "#1E4266" },
  CLOSED: { bg: "#E4EFE8", fg: "#2E7D5B" },
};

const PRIORITY_STYLE: Record<RfiPriority, { bg: string; fg: string }> = {
  LOW: { bg: "#F1EEE4", fg: "#4E5866" },
  MEDIUM: { bg: "#E9F0F7", fg: "#1E4266" },
  HIGH: { bg: "#F3DFDF", fg: "#B33A3A" },
};

export default async function RfiListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/projects/${(await params).id}/snapshot`);
  }

  const { id: projectId } = await params;
  const { status } = await searchParams;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const where: { projectId: string; status?: RfiStatus } = { projectId };
  if (status === "OPEN" || status === "ANSWERED" || status === "CLOSED") {
    where.status = status;
  }

  const [rfis, grouped] = await Promise.all([
    prisma.rfi.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      include: {
        raisedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.rfi.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = { OPEN: 0, ANSWERED: 0, CLOSED: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;
  const total = counts.OPEN + counts.ANSWERED + counts.CLOSED;

  const filter = status ?? "";

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href={`/projects/${projectId}/snapshot`}
              className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"
            >
              ← Back to {project.name}
            </Link>
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight mt-2">
              RFIs · Requests for Information
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              Formal queries from site to consultants / designers. Sorted by status, then priority.
            </p>
          </div>
          <Link
            href={`/projects/${projectId}/rfi/new`}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-stone-900 text-white px-4 py-2 hover:bg-stone-800"
          >
            <Plus className="w-4 h-4" />
            New RFI
          </Link>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 flex-wrap">
          <FilterChip href={`/projects/${projectId}/rfi`} active={filter === ""} label="All" count={total} />
          <FilterChip href={`/projects/${projectId}/rfi?status=OPEN`} active={filter === "OPEN"} label="Open" count={counts.OPEN} />
          <FilterChip href={`/projects/${projectId}/rfi?status=ANSWERED`} active={filter === "ANSWERED"} label="Answered" count={counts.ANSWERED} />
          <FilterChip href={`/projects/${projectId}/rfi?status=CLOSED`} active={filter === "CLOSED"} label="Closed" count={counts.CLOSED} />
        </div>

        {rfis.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 p-12 text-center text-stone-500">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 text-stone-300" />
            {filter
              ? <>No {RFI_STATUS_LABELS[filter as RfiStatus].toLowerCase()} RFIs. <Link href={`/projects/${projectId}/rfi`} className="text-stone-900 underline">Show all</Link></>
              : <>No RFIs yet. <Link href={`/projects/${projectId}/rfi/new`} className="text-stone-900 underline">Raise the first one</Link></>}
          </div>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">Subject</th>
                  <th className="text-left px-4 py-2 font-medium">Category</th>
                  <th className="text-left px-4 py-2 font-medium">Priority</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Raised by</th>
                  <th className="text-left px-4 py-2 font-medium">Assigned to</th>
                  <th className="text-right px-4 py-2 font-medium">Due</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rfis.map((r) => (
                  <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-stone-500 whitespace-nowrap">
                      {formatRfiNumber(r.number)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/projects/${projectId}/rfi/${r.id}`} className="text-stone-900 hover:underline">
                        {r.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-xs whitespace-nowrap">
                      {RFI_CATEGORY_LABELS[r.category as RfiCategory] ?? r.category}
                    </td>
                    <td className="px-4 py-3">
                      <Pill label={RFI_PRIORITY_LABELS[r.priority as RfiPriority] ?? r.priority}
                            style={PRIORITY_STYLE[r.priority as RfiPriority] ?? { bg: "#F1EEE4", fg: "#4E5866" }} />
                    </td>
                    <td className="px-4 py-3">
                      <Pill label={RFI_STATUS_LABELS[r.status as RfiStatus] ?? r.status}
                            style={STATUS_STYLE[r.status as RfiStatus] ?? { bg: "#F1EEE4", fg: "#4E5866" }} />
                    </td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{r.raisedBy.name}</td>
                    <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                      {r.assignedTo?.name ?? <span className="text-stone-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-500 text-xs whitespace-nowrap">
                      {r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="px-2 text-stone-400">
                      <Link href={`/projects/${projectId}/rfi/${r.id}`}><ChevronRight className="w-4 h-4" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function FilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors";
  const cls = active
    ? `${base} bg-stone-900 text-white`
    : `${base} bg-white text-stone-600 border border-stone-200 hover:bg-stone-50`;
  return (
    <Link href={href} className={cls}>
      {label}
      <span className={active ? "text-white/80" : "text-stone-400"}>{count}</span>
    </Link>
  );
}

function Pill({ label, style }: { label: string; style: { bg: string; fg: string } }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  );
}
