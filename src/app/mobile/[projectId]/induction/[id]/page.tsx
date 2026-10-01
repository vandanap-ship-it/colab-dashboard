import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock, CheckCircle2, X, CalendarClock, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessModule, MODULES } from "@/lib/modules";
import { canReview } from "@/lib/roles";
import MobileInductionActions from "@/components/mobile/MobileInductionActions";

export const dynamic = "force-dynamic";

/**
 * Mobile Safety Induction detail — read the full worker profile, see the
 * Aadhaar + signature photos the maker captured, and (if you're the
 * reviewer) decide. The reviewer bar at the bottom is a client component
 * so it can PATCH and refresh in place; the rest of the page is server-
 * rendered so photos + maker + status stay authoritative.
 */
export default async function MobileInductionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; id: string }>;
  searchParams: Promise<{ tab?: string; chip?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId, id } = await params;
  const { tab, chip } = await searchParams;

  if (!canAccessModule(session.user.modules, MODULES.SAFETY)) {
    redirect(`/mobile/${projectId}`);
  }

  const induction = await prisma.safetyInduction.findUnique({
    where: { id },
    include: {
      contractor: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, role: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
    },
  });
  if (!induction || induction.deletedAt) notFound();

  // Pin a single "now" value for the whole request so the days-left
  // math stays stable across the renders of this server component.
  const nowMs = new Date().getTime();
  const iAmMaker = induction.createdById === session.user.id;
  // Reviewer eligibility: canReview + SAFETY module. Current user also
  // can't be the maker (separation of duty — the server guards this too).
  const iCanReview = canReview(session.user.role) && !iAmMaker;

  // Back link preserves the tab + chip context the reviewer came from.
  const backHref =
    `/mobile/${projectId}/induction?tab=${tab ?? (iCanReview ? "assigned" : "me")}` +
    (chip ? `&chip=${chip}` : "");

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      <header
        className="px-4 pt-4 pb-3 border-b border-sandstone-100 flex items-center gap-3"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <Link
          href={backHref}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sandstone-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[20px] leading-tight text-ink tracking-tight truncate">
            {induction.workerName}
          </h1>
          <p className="text-[12px] text-ink-3 truncate">
            {induction.displayId} · {induction.trade}
          </p>
        </div>
        <StatusPill status={induction.status} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-32 space-y-4">
        {/* Primary photo */}
        <section className="flex items-center gap-4">
          {induction.workerPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={induction.workerPhotoUrl}
              alt=""
              className="w-24 h-24 rounded-full object-cover border-2 border-sandstone-200"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-sandstone-100 flex items-center justify-center">
              <ShieldCheck className="w-10 h-10 text-ferrous-600" />
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <KV label="Contractor" value={induction.contractor?.name ?? "—"} />
            <KV label="Gender" value={induction.gender} />
            {induction.age != null && <KV label="Age" value={String(induction.age)} />}
          </div>
        </section>

        {/* Worker details card — "tall" layout per Shraddha 2026-10-01,
            single column, each row stacks label on top of value. */}
        <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Worker details
          </h2>
          {induction.dob && (
            <StackKV label="Date of birth" value={fmtDate(induction.dob)} />
          )}
          {induction.contactNumber && (
            <StackKV label="Contact" value={induction.contactNumber} />
          )}
          {induction.aadhaarNumber && (
            <StackKV
              label="Aadhaar number"
              value={formatAadhaar(induction.aadhaarNumber)}
            />
          )}
        </section>

        {/* Dates */}
        <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Induction & Validity
          </h2>
          <StackKV label="Induction date" value={fmtDate(induction.inductionDate)} />
          <StackKV
            label="Expiry date"
            value={fmtDate(induction.expiryDate)}
            emphasis={isExpiringSoon(induction.expiryDate, induction.status, nowMs)}
          />
          <StackKV label="Raised by" value={induction.createdBy.name ?? induction.createdBy.role} />
          {induction.approvedBy && induction.approvedAt && (
            <StackKV
              label="Approved by"
              value={`${induction.approvedBy.name} · ${fmtDateTime(induction.approvedAt)}`}
            />
          )}
          {induction.rejectedBy && induction.rejectedAt && (
            <StackKV
              label="Rejected by"
              value={`${induction.rejectedBy.name} · ${fmtDateTime(induction.rejectedAt)}`}
            />
          )}
          {induction.rejectionReason && (
            <StackKV label="Rejection reason" value={induction.rejectionReason} />
          )}
        </section>

        {/* Supporting photos — grid of 3 if present, each tappable to
            full-screen. Hidden entirely when all three are null (new
            inductions sometimes have incomplete uploads at save time;
            no reason to show empty tiles). */}
        {(induction.aadhaarFrontUrl || induction.aadhaarBackUrl || induction.signatureUrl) && (
          <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              Supporting photos
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <PhotoThumb url={induction.aadhaarFrontUrl} label="Aadhaar front" />
              <PhotoThumb url={induction.aadhaarBackUrl} label="Aadhaar back" />
              <PhotoThumb url={induction.signatureUrl} label="Signature" />
            </div>
          </section>
        )}
      </div>

      {/* Sticky bottom bar — three variants, same shape as the WIR
          reviewer bar.
            iCanReview && PENDING → Approve / Reject
            maker viewing own PENDING → quiet "waiting for review" hint
            terminal (APPROVED / REJECTED / EXPIRED) → status callout */}
      {induction.status === "PENDING" && iCanReview && (
        <div
          className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <MobileInductionActions
            inductionId={induction.id}
            projectId={projectId}
            expectedUpdatedAt={induction.updatedAt.toISOString()}
          />
        </div>
      )}
      {induction.status === "PENDING" && !iCanReview && (
        <div
          className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <p className="rounded-lg bg-amber-50 ring-1 ring-amber-200 text-amber-800 text-xs p-2.5 text-center">
            Waiting for Girish R to review this induction.
          </p>
        </div>
      )}
      {induction.status !== "PENDING" && (
        <div
          className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <TerminalCallout status={induction.status} expiryDate={induction.expiryDate} nowMs={nowMs} />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string; Icon: typeof CheckCircle2 }> = {
    PENDING: { bg: "bg-amber-50 ring-amber-200", fg: "text-amber-800", label: "Pending", Icon: Clock },
    APPROVED: { bg: "bg-emerald-50 ring-emerald-200", fg: "text-emerald-800", label: "Approved", Icon: CheckCircle2 },
    REJECTED: { bg: "bg-red-50 ring-red-200", fg: "text-red-800", label: "Rejected", Icon: X },
    EXPIRED: { bg: "bg-stone-100 ring-stone-300", fg: "text-stone-700", label: "Expired", Icon: CalendarClock },
  };
  const cfg = map[status] ?? map.PENDING;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.bg} ${cfg.fg}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function TerminalCallout({ status, expiryDate, nowMs }: { status: string; expiryDate: Date; nowMs: number }) {
  if (status === "APPROVED") {
    const daysLeft = Math.floor((new Date(expiryDate).getTime() - nowMs) / (24 * 60 * 60 * 1000));
    return (
      <p className="rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800 text-xs p-2.5 text-center">
        Approved. Induction expires in {daysLeft} day{daysLeft === 1 ? "" : "s"}.
      </p>
    );
  }
  if (status === "REJECTED") {
    return (
      <p className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-800 text-xs p-2.5 text-center">
        This induction was rejected. Raise a fresh one with the issues addressed.
      </p>
    );
  }
  return (
    <p className="rounded-lg bg-stone-100 ring-1 ring-stone-300 text-stone-700 text-xs p-2.5 text-center">
      This induction has expired. Raise a fresh one for this worker.
    </p>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-[12px]">
      <span className="text-stone-500">{label}:</span>{" "}
      <span className="text-ink font-medium">{value}</span>
    </div>
  );
}

function StackKV({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className={`text-[14px] leading-snug ${emphasis ? "text-ferrous-700 font-semibold" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function PhotoThumb({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="aspect-square rounded-lg border border-dashed border-stone-300 bg-stone-50 flex items-center justify-center text-[10px] text-stone-400 text-center p-1">
        {label}
        <br />—
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener" className="block aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="w-full h-full object-cover" loading="lazy" />
    </a>
  );
}

function isExpiringSoon(expiryDate: Date, status: string, nowMs: number): boolean {
  if (status !== "APPROVED") return false;
  return new Date(expiryDate).getTime() - nowMs < 30 * 24 * 60 * 60 * 1000;
}

function formatAadhaar(n: string): string {
  // 12 digits → "XXXX XXXX XXXX" for readability. Fine for display;
  // the DB stores the raw 12-digit form so searches and uniqueness
  // guards work.
  return n.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtDateTime(d: Date): string {
  const date = new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const time = new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  return `${date}, ${time}`;
}
