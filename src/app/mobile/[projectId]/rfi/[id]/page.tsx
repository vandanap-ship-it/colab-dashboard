import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar, MessageCircle } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { formatRfiNumber, RFI_CATEGORY_LABELS, type RfiCategory, type RfiStatus } from "@/lib/rfi";
import { rfiAgeFor, rfiDueSignal, type RfiDueSignal } from "@/lib/queueAge";
import MobileRfiActions from "@/components/mobile/MobileRfiActions";

export const dynamic = "force-dynamic";

/**
 * Mobile RFI detail — subject + description read cleanly, meta card
 * below with raiser, assignee, activity, category, dates. If an answer
 * is on file, it renders as its own emphasised card with the answerer
 * and the answered-at date. Sticky action bar below drives status
 * transitions via /api/rfi/[id].
 */
export default async function MobileRfiDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.RFI)) {
    redirect(`/mobile/${projectId}`);
  }

  const rfi = await prisma.rfi.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      raisedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      answeredBy: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!rfi) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold uppercase tracking-[0.14em]">
          <span className="font-mono text-ferrous-600 tracking-wider">
            {formatRfiNumber(rfi.number)}
          </span>
          <StatusPill status={rfi.status} />
          {/* Two-tier signal on OPEN: explicit dueDate wins over the
              wall-clock aging chip when the raiser set one. Same rule
              the list card uses. */}
          {rfi.status === "OPEN" && rfi.dueDate && (
            <DetailRfiDueChip signal={rfiDueSignal(rfi.dueDate)} />
          )}
          {rfi.status === "OPEN" && !rfi.dueDate && (
            <DetailRfiAgingChip createdAt={rfi.createdAt} />
          )}
          <PriorityPill priority={rfi.priority} />
          <span className="rounded-full bg-sandstone-100 text-ink-2 px-2 py-0.5 font-semibold text-[9.5px]">
            {RFI_CATEGORY_LABELS[rfi.category as RfiCategory] ?? rfi.category}
          </span>
        </div>
        <h1 className="font-serif text-[22px] leading-snug text-ink tracking-tight mt-2">
          {rfi.subject}
        </h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Question */}
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <MessageCircle className="w-3 h-3" />
            Question
          </div>
          <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
            {rfi.description}
          </p>
        </section>

        {/* Answer (only when there is one) */}
        {rfi.answer && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-wider mb-2 flex items-center gap-1">
              <MessageCircle className="w-3 h-3" />
              Answer
            </div>
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
              {rfi.answer}
            </p>
            {rfi.answeredBy && rfi.answeredAt && (
              <div className="text-[11px] text-ink-3 mt-3 pt-2 border-t border-emerald-200 flex items-center gap-2">
                <span>Answered by {rfi.answeredBy.name}</span>
                <span>·</span>
                <span>{fmtDate(rfi.answeredAt)}</span>
              </div>
            )}
          </section>
        )}

        {/* Meta */}
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised by</span>
            <span className="font-medium">{rfi.raisedBy.name}</span>
          </div>
          {rfi.assignedTo && (
            <div className="flex items-center gap-2 text-stone-700">
              <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Assigned to</span>
              <span className="font-medium">{rfi.assignedTo.name}</span>
            </div>
          )}
          {rfi.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{rfi.wbsNode.name}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
            <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised</span>
            <span className="font-medium">{fmtDate(rfi.createdAt)}</span>
            {rfi.dueDate && (
              <>
                <span className="text-stone-400">·</span>
                <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Due</span>
                <span className="font-medium">{fmtDate(rfi.dueDate)}</span>
              </>
            )}
          </div>
        </section>

        {/* Photos */}
        {rfi.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {rfi.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {rfi.photos.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200 block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
        <MobileRfiActions
          rfiId={rfi.id}
          currentStatus={rfi.status as RfiStatus}
          expectedUpdatedAt={rfi.updatedAt.toISOString()}
          projectId={projectId}
        />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    OPEN: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Open" },
    ANSWERED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Answered" },
    CLOSED: { bg: "bg-stone-100 ring-stone-200", fg: "text-stone-700", label: "Closed" },
  };
  const cfg = map[status] ?? map.OPEN;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    HIGH: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "High" },
    MEDIUM: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Med" },
    LOW: { bg: "bg-stone-50 ring-stone-200", fg: "text-stone-700", label: "Low" },
  };
  const cfg = map[priority];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

/**
 * Detail-hero variant of the list card's RfiDueChip. Same three-way
 * signal (overdue / due-today / upcoming), same "hide if > 5d out"
 * upcoming cap. Inline `normal-case tracking-normal` cancels the
 * hero's UPPERCASE tracking so the chip sits cleanly beside the
 * status/priority pills.
 */
function DetailRfiDueChip({ signal }: { signal: RfiDueSignal }) {
  if (signal.kind === "upcoming" && signal.days > 5) return null;
  const cls =
    signal.kind === "overdue"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : signal.kind === "due-today"
        ? "bg-sandstone-100 ring-sandstone-200 text-ink-2"
        : "bg-stone-100 ring-stone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums normal-case tracking-normal ${cls}`}
    >
      {signal.label}
    </span>
  );
}

/**
 * Detail-hero variant of the list card's RFI aging chip. Same math,
 * inline styling that neutralizes the hero's UPPERCASE tracking so
 * the chip reads as its own tabular-num pill next to the status
 * badges. Used only when the RFI has no explicit dueDate.
 */
function DetailRfiAgingChip({ createdAt }: { createdAt: Date }) {
  const age = rfiAgeFor(createdAt);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums normal-case tracking-normal ${cls}`}
      title={`Raised ${fmtDate(createdAt)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
