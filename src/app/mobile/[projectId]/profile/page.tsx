import { Camera, KeyRound, Mail, Phone, RefreshCw, User as UserIcon } from "lucide-react";
import { signOut } from "@/lib/auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/roles";
import SwitchProjectButton from "@/components/SwitchProjectButton";
import SignOutButton from "@/components/SignOutButton";
import PushTestButton from "@/components/PushTestButton";

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
  const [user, latestProgress, latestHindrance, latestIssue, latestConcern, photoCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
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

      {/* Switch project — only edit-facing action shipped in V1. Any
          change to contact fields or password below routes through the
          product team, matching the support model in the release notes. */}
      <SwitchProjectButton compact />

      {/* Account — the four fields Shraddha said actually matter:
          phone, email, username, password. Fields we don't have data
          for (phone) show a friendly "not on file" line rather than a
          dashed v1.1 stub, and clearly point at the product team as the
          one door for changes. */}
      <Section title="Account" icon={<UserIcon className="w-3.5 h-3.5" />}>
        <RowWithIcon
          label="Phone"
          value="Not on file"
          muted
          icon={<Phone className="w-3.5 h-3.5 text-stone-400" />}
        />
        <RowWithIcon
          label="Email"
          value={user?.email ?? "Not on file"}
          muted={!user?.email}
          icon={<Mail className="w-3.5 h-3.5 text-stone-400" />}
        />
        <RowWithIcon
          label="Username"
          value={session.user.username ?? "—"}
          icon={<UserIcon className="w-3.5 h-3.5 text-stone-400" />}
        />
        <RowWithIcon
          label="Password"
          value="••••••••"
          icon={<KeyRound className="w-3.5 h-3.5 text-stone-400" />}
        />
        <p className="text-[11px] text-stone-500 leading-relaxed pt-1">
          To change your phone, email, or password, ask the product team.
        </p>
      </Section>

      {/* Sync status — kept, useful signal. Renamed "Available for Sync"
          off the misleading "0 offline queue v1.1" line; PendingSyncBadge
          in the header already carries the live count. */}
      <Section title="Sync" icon={<RefreshCw className="w-3.5 h-3.5" />}>
        <Row
          label="Last activity"
          value={lastSync.toLocaleString(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
        <RowWithIcon
          label="Photos uploaded"
          value={String(photoCount)}
          icon={<Camera className="w-3.5 h-3.5 text-stone-400" />}
        />
      </Section>

      {/* Test push — one-tap verification the phone is actually receiving
          notifications. Empty-state text nudges the user to Turn on
          notifications first if they haven't. */}
      <PushTestButton />

      <SignOutButton action={handleSignOut} />
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
  muted = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  /** Muted value styling for "Not on file" placeholders — signals absent
   *  data without a v1.1 tag lecture. */
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm gap-3">
      <span className="text-stone-500 flex items-center gap-1.5 shrink-0">
        {icon}
        {label}
      </span>
      <span
        className={`font-medium text-right truncate min-w-0 ${
          muted ? "text-stone-400 italic font-normal" : "text-stone-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
