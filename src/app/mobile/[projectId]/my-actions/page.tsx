import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bug, HelpCircle, MessageSquare, ShieldCheck, ClipboardList, Inbox } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReview } from "@/lib/roles";
import { formatRfiNumber } from "@/lib/rfi";

export const dynamic = "force-dynamic";

/**
 * Mobile "My Actions" — the single screen a site engineer / planner opens to
 * see everything that needs THEM today. Server-fetches five queues:
 *
 *   1. Snags assigned to me + still OPEN            → tap to detail
 *   2. RFIs assigned to me + still OPEN             → tap to detail
 *   3. Concerns assigned to me (PENDING/TASK_ASSIGNED)
 *   4. Work permits pending my approval (I'm in the approver set)
 *   5. WIRs in review (reviewers only — planners / product / admin)
 *
 * Each section is its own card. Empty sections DON'T render — a clean page
 * with three items is more honest than a page with two lists and three
 * empty "no items" tiles. Section counts show at the eyebrow so the
 * engineer scans quickly.
 *
 * Copy leans on ownership: "Snags to fix", "RFIs to answer", "Concerns
 * to address", "Permits to approve", "WIRs to review". Verbs, not
 * nouns, because verbs are the whole point of this screen.
 */
export default async function MobileMyActionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;
  const userId = session.user.id;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const iCanReview = canReview(session.user.role);

  // All five queues in parallel — this is the tightest server-fetch on the
  // app, so we lean into Promise.all to keep the page open time low.
  const [snags, rfis, concerns, permits, wirsToReview] = await Promise.all([
    prisma.issue.findMany({
      where: { projectId, deletedAt: null, assignedToId: userId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        description: true,
        severity: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        wbsNode: { select: { name: true } },
      },
    }),
    prisma.rfi.findMany({
      where: { projectId, deletedAt: null, assignedToId: userId, status: "OPEN" },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        number: true,
        subject: true,
        priority: true,
        dueDate: true,
        raisedBy: { select: { name: true } },
      },
    }),
    prisma.concern.findMany({
      where: {
        projectId,
        deletedAt: null,
        assignedToId: userId,
        status: { in: ["PENDING", "TASK_ASSIGNED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        raisedBy: { select: { name: true } },
      },
    }),
    // WorkPermit.approverIds is a JSON-encoded array of userIds stored in a
    // text column. `contains: userId` gives us "my ID appears in the
    // approvers list" without a JSON scan. That's the same query the
    // desktop permit inbox uses.
    prisma.workPermit.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: "PENDING",
        approverIds: { contains: userId },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        type: true,
        title: true,
        workDate: true,
        startTime: true,
        endTime: true,
        location: true,
        requester: { select: { name: true } },
      },
    }),
    iCanReview
      ? prisma.inspection.findMany({
          where: { projectId, deletedAt: null, status: "IN_REVIEW" },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            title: true,
            module: true,
            createdAt: true,
            filledBy: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const total = snags.length + rfis.length + concerns.length + permits.length + wirsToReview.length;

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <div
        className="px-5 pt-6 pb-6 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          On your desk
        </p>
        <h1 className="font-serif text-[32px] leading-[1.1] text-ink tracking-tight mt-1">
          My actions
        </h1>
        <p className="text-[13px] text-ink-3 mt-1.5">
          {total === 0
            ? "Nothing waiting for you. Nice."
            : `${total} item${total === 1 ? "" : "s"} across your queues.`}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        {total === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-10 text-center">
            <Inbox className="w-6 h-6 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500 mt-2">
              You&apos;re all clear. Come back later or open Home to log
              progress.
            </p>
          </div>
        ) : (
          <>
            {snags.length > 0 && (
              <ActionSection eyebrow="Snags to fix" count={snags.length} icon={Bug}>
                {snags.map((s) => (
                  <ActionRow
                    key={s.id}
                    href={`/mobile/${projectId}/issue/${s.id}?tab=open`}
                    primary={s.description}
                    secondary={secondaryLine(s.createdBy?.name, s.wbsNode?.name, fmtDate(s.createdAt))}
                    right={s.severity ? severityLabel(s.severity) : undefined}
                  />
                ))}
              </ActionSection>
            )}

            {rfis.length > 0 && (
              <ActionSection eyebrow="RFIs to answer" count={rfis.length} icon={HelpCircle}>
                {rfis.map((r) => (
                  <ActionRow
                    key={r.id}
                    href={`/mobile/${projectId}/rfi/${r.id}?tab=open`}
                    label={formatRfiNumber(r.number)}
                    primary={r.subject}
                    secondary={secondaryLine(r.raisedBy?.name, r.dueDate ? `due ${fmtDate(r.dueDate)}` : undefined)}
                    right={r.priority !== "MEDIUM" ? priorityLabel(r.priority) : undefined}
                  />
                ))}
              </ActionSection>
            )}

            {concerns.length > 0 && (
              <ActionSection eyebrow="Concerns to address" count={concerns.length} icon={MessageSquare}>
                {concerns.map((c) => (
                  <ActionRow
                    key={c.id}
                    href={`/mobile/${projectId}/concern/${c.id}?tab=${c.status === "PENDING" ? "pending" : "task_assigned"}`}
                    primary={c.description}
                    secondary={secondaryLine(c.raisedBy?.name, fmtDate(c.createdAt))}
                  />
                ))}
              </ActionSection>
            )}

            {permits.length > 0 && (
              <ActionSection eyebrow="Permits to approve" count={permits.length} icon={ShieldCheck}>
                {permits.map((p) => (
                  <ActionRow
                    key={p.id}
                    href={`/mobile/${projectId}/permit/${p.id}`}
                    label={p.type.replace(/_/g, " ")}
                    primary={p.title}
                    secondary={secondaryLine(
                      p.requester?.name,
                      `${fmtDate(p.workDate)} · ${p.startTime}-${p.endTime}`,
                      p.location ?? undefined,
                    )}
                  />
                ))}
              </ActionSection>
            )}

            {wirsToReview.length > 0 && (
              <ActionSection eyebrow="WIRs to review" count={wirsToReview.length} icon={ClipboardList}>
                {wirsToReview.map((i) => (
                  <ActionRow
                    key={i.id}
                    href={`/mobile/${projectId}/qaqc/${i.id}?tab=pending${i.module ? `&module=${i.module}` : ""}`}
                    label={i.module === "SAFETY" ? "EHS" : "QA/QC"}
                    primary={i.title}
                    secondary={secondaryLine(i.filledBy?.name, fmtDate(i.createdAt))}
                  />
                ))}
              </ActionSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational
// ---------------------------------------------------------------------------

function ActionSection({
  eyebrow,
  count,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  count: number;
  icon: typeof Bug;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon className="w-4 h-4 text-ferrous-600" />
        <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
          {eyebrow}
        </span>
        <span className="rounded-full bg-sandstone-100 text-ink-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums min-w-[18px] text-center">
          {count}
        </span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function ActionRow({
  href,
  label,
  primary,
  secondary,
  right,
}: {
  href: string;
  label?: string;
  primary: string;
  secondary?: string;
  right?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-3.5 block active:bg-sandstone-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {label && (
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ferrous-600 mb-0.5">
                {label}
              </div>
            )}
            <div className="text-[14px] text-ink leading-snug line-clamp-2">
              {primary}
            </div>
            {secondary && (
              <div className="text-[11.5px] text-ink-3 mt-1">{secondary}</div>
            )}
          </div>
          {right && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-2 shrink-0 mt-0.5">
              {right}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function secondaryLine(...bits: (string | undefined | null)[]): string | undefined {
  const parts = bits.filter((b): b is string => !!b && b.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}
function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function severityLabel(sev: string): string {
  return sev === "HIGH" ? "High" : sev === "MEDIUM" ? "Med" : sev === "LOW" ? "Low" : sev;
}
function priorityLabel(pri: string): string {
  return pri === "HIGH" ? "High" : pri === "LOW" ? "Low" : pri === "MEDIUM" ? "Med" : pri;
}
