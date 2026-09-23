import { notFound, redirect } from "next/navigation";
import { User as UserIcon, Camera, Calendar, Wrench, TimerReset } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import { reasonLabel } from "@/lib/hindranceReasons";
import { hindranceAgeFor } from "@/lib/queueAge";
import MobileHindranceActions from "@/components/mobile/MobileHindranceActions";

export const dynamic = "force-dynamic";

/**
 * Mobile Hindrance detail — status pill (Open / Resolved), Fraunces
 * description, meta card (raiser, responsible contractor, activity, dates,
 * days impact, cost impact, reason), photo grid, reviewer-only sticky
 * action bar.
 */
export default async function MobileHindranceDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { projectId, id } = await params;

  if (!canAccessModule(session.user.modules, MODULES.HINDRANCE)) {
    redirect(`/mobile/${projectId}`);
  }

  const h = await prisma.hindrance.findFirst({
    where: { id, projectId, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      responsibleContractor: { select: { id: true, name: true } },
      wbsNode: { select: { id: true, name: true } },
      photos: { select: { id: true, url: true } },
    },
  });
  if (!h) notFound();

  const iCanReview = canReview(session.user.role);

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={h.status} />
          {/* Same aging cue the list card wears — silent on fresh
              blockers, sandstone at 2d, ferrous at 3d. Skipped for
              RESOLVED rows: aging says nothing once the blocker's
              done. */}
          {h.status === "OPEN" && <DetailHindranceAgingChip startDate={h.startDate} />}
        </div>
        <h1 className="font-serif text-[20px] leading-snug text-ink tracking-tight mt-2">
          {h.description}
        </h1>
        {h.reasonNote && (
          <p className="text-[13px] text-ink-3 mt-2 italic leading-snug">
            &ldquo;{h.reasonNote}&rdquo;
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <section className="rounded-xl border border-stone-200 bg-white p-3 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-stone-700">
            <UserIcon className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Raised by</span>
            <span className="font-medium">{h.createdBy.name}</span>
          </div>
          {h.responsibleContractor && (
            <div className="flex items-center gap-2 text-stone-700">
              <Wrench className="w-4 h-4 text-stone-400 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Responsible</span>
              <span className="font-medium">{h.responsibleContractor.name}</span>
            </div>
          )}
          {h.responsibleTeam && (
            <div className="flex items-center gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Team</span>
              <span className="font-medium">{h.responsibleTeam}</span>
            </div>
          )}
          {h.wbsNode && (
            <div className="flex items-start gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1 shrink-0 pt-0.5">Activity</span>
              <span className="font-medium leading-snug">{h.wbsNode.name}</span>
            </div>
          )}
          {h.reasonCode && (
            <div className="flex items-center gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Reason</span>
              <span className="font-medium">{reasonLabel(h.reasonCode)}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-stone-700 pt-2 border-t border-stone-100 mt-2">
            <Calendar className="w-4 h-4 text-stone-400 shrink-0" />
            <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">From</span>
            <span className="font-medium">{fmtDate(h.startDate)}</span>
            {h.endDate && (
              <>
                <span className="text-stone-400">→</span>
                <span className="font-medium">{fmtDate(h.endDate)}</span>
              </>
            )}
          </div>
          {h.resolvedDate && (
            <div className="flex items-center gap-2 text-stone-700">
              <span className="w-4 h-4 shrink-0" />
              <span className="text-stone-500 text-xs uppercase tracking-wider mr-1">Resolved</span>
              <span className="font-medium">{fmtDate(h.resolvedDate)}</span>
            </div>
          )}
        </section>

        {/* Days-lost tile — only renders when the field is actually filled
            so we don't scream "0 days" at people who left it blank. */}
        {h.daysImpact != null && (
          <section>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Days lost</div>
              <div className="flex items-center gap-2 mt-1">
                <TimerReset className="w-4 h-4 text-ferrous-600" />
                <span className="text-xl font-semibold tabular-nums text-stone-900">{h.daysImpact}</span>
              </div>
            </div>
          </section>
        )}

        {h.photos.length > 0 && (
          <section className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Camera className="w-3 h-3" />
              Photos · {h.photos.length}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {h.photos.map((p) => (
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

      {iCanReview && (
        <div className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3">
          <MobileHindranceActions
            hindranceId={h.id}
            currentStatus={h.status as "OPEN" | "RESOLVED"}
            expectedUpdatedAt={h.updatedAt.toISOString()}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    OPEN: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Open" },
    RESOLVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Resolved" },
  };
  const cfg = map[status] ?? map.OPEN;
  return (
    <span className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      {cfg.label}
    </span>
  );
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Detail-hero aging chip. Same math as the list-card variant so a
 * blocker reads at the same tier on both surfaces; kept as a local
 * helper (not shared with the list) so hero-density tweaks can happen
 * without disturbing the list.
 */
function DetailHindranceAgingChip({ startDate }: { startDate: Date }) {
  const age = hindranceAgeFor(startDate);
  if (age.tier === "fresh") return null;
  const cls =
    age.tier === "stale"
      ? "bg-ferrous-50 ring-ferrous-200 text-ferrous-700"
      : "bg-sandstone-100 ring-sandstone-200 text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
      title={`Started ${fmtDate(startDate)} · ${age.days} day${age.days === 1 ? "" : "s"} ago`}
    >
      {age.label}
    </span>
  );
}
