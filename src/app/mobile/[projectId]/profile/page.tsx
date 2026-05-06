import { Camera, LogOut, RefreshCw, ShieldAlert, UserCog } from "lucide-react";
import { signOut } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/roles";
import SwitchProjectButton from "@/components/SwitchProjectButton";

function initials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default async function MobileProfilePage() {
  const session = await auth();
  if (!session?.user) return null;

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const userId = session.user.id;
  const [latestProgress, latestHindrance, latestIssue, latestConcern, photoCount] =
    await Promise.all([
      prisma.progressEntry.findFirst({
        where: { createdById: userId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.hindrance.findFirst({
        where: { createdById: userId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.issue.findFirst({
        where: { createdById: userId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.concern.findFirst({
        where: { raisedById: userId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prisma.progressPhoto.count({
        where: { progressEntry: { createdById: userId } },
      }),
    ]);

  const latestActivity = [latestProgress, latestHindrance, latestIssue, latestConcern]
    .map((r) => r?.updatedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const lastSync = latestActivity ?? new Date();

  return (
    <div className="px-4 py-6 space-y-4">
      {/* Identity card with brand-tinted gradient */}
      <section className="rounded-2xl bg-stone-900 text-white p-5 shadow-card relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 0% 0%, rgba(251, 191, 36, 0.18), transparent 45%)",
          }}
        />
        <div className="relative flex items-center gap-4">
          <span className="w-14 h-14 rounded-full bg-white/10 ring-2 ring-white/20 backdrop-blur-sm flex items-center justify-center text-lg font-semibold tracking-tight">
            {initials(session.user.name)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold truncate">
              Hi, {session.user.name ?? session.user.username}
            </p>
            <p className="text-xs text-stone-300 truncate">@{session.user.username}</p>
            <p className="text-[10px] uppercase tracking-widest text-brand-300 mt-1">
              {ROLE_LABELS[session.user.role] ?? session.user.role}
            </p>
          </div>
        </div>
      </section>

      {/* Action row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white py-2 text-sm font-medium text-stone-400 cursor-not-allowed"
          title="Edit profile coming in v1.1"
        >
          <UserCog className="w-4 h-4" />
          Edit Profile
        </button>
        <SwitchProjectButton compact />
      </div>

      {/* Personal details */}
      <Section title="Personal details">
        <Row label="Status" value="Active" />
        <Row label="Date of Birth" value="—" subtle="v1.1" />
      </Section>

      {/* Emergency contact (stubs for v1.1) */}
      <Section title="Emergency Contact" icon={<ShieldAlert className="w-3.5 h-3.5" />}>
        <Row label="Person" value="—" subtle="v1.1" />
        <Row label="Mobile" value="—" subtle="v1.1" />
        <Row label="Alternate mobile" value="—" subtle="v1.1" />
      </Section>

      {/* Sync status */}
      <Section title="Sync" icon={<RefreshCw className="w-3.5 h-3.5" />}>
        <Row
          label="Last sync"
          value={lastSync.toLocaleString(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
        <Row label="Available for Sync" value="0" subtle="offline queue v1.1" />
        <RowWithIcon
          label="Photos uploaded"
          value={String(photoCount)}
          icon={<Camera className="w-3.5 h-3.5 text-stone-400" />}
        />
      </Section>

      <form action={handleSignOut}>
        <button
          type="submit"
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 hover:border-stone-300 transition-colors"
        >
          <LogOut className="w-4 h-4 text-stone-400" />
          Sign out
        </button>
      </form>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
      <h2 className="text-[10px] uppercase tracking-widest text-stone-500 flex items-center gap-1.5">
        {icon}
        {title}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm gap-2">
      <span className="text-stone-500">{label}</span>
      <span className="text-right">
        <span className="font-medium text-stone-900">{value}</span>
        {subtle && (
          <span className="ml-1 text-[10px] text-stone-400 uppercase tracking-wider">
            {subtle}
          </span>
        )}
      </span>
    </div>
  );
}

function RowWithIcon({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm gap-2">
      <span className="text-stone-500 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-medium text-stone-900 tabular-nums">{value}</span>
    </div>
  );
}
