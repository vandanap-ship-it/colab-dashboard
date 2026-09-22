import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeMobile } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { getPendingActionCount } from "@/lib/pendingActions";
import { getUnreadNotificationCount } from "@/lib/notifications";
import MobileHeaderBack from "@/components/MobileHeaderBack";
import MobileBottomNav from "@/components/MobileBottomNav";
import MobileOnboarding from "@/components/MobileOnboarding";
import PendingSyncBadge from "@/components/PendingSyncBadge";
import PushOptIn from "@/components/PushOptIn";
import BellAutoRefresh from "@/components/BellAutoRefresh";
import QuickAddFab from "@/components/mobile/QuickAddFab";
import { quickActionsFor } from "@/lib/quickActions";

export default async function MobileProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/mobile");
  if (!canSeeMobile(session.user.role)) redirect("/");

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  // Pending-action count for the bottom-nav "Info" badge. Small count query,
  // runs once per layout render. Kept optional — if the query fails, the
  // nav still renders without a badge (defensive: never block the mobile
  // shell from loading on account of a nav ornament).
  // Two nav-badge counts run in parallel so a slow one doesn't block the
  // other. Both are defensive: a query failure returns 0 rather than
  // crashing the layout — a missing badge is safer than a broken shell.
  const [pendingActions, unreadNotifications] = await Promise.all([
    getPendingActionCount(project.id, session.user.id, session.user.role).catch(() => 0),
    getUnreadNotificationCount(session.user.id).catch(() => 0),
  ]);

  // Filter the quick-add sheet to actions the current user's modules
  // actually permit. Derivation lives in src/lib/quickActions so the
  // gating is pure and the role-visibility golden tests can exercise
  // every persona directly.
  const quickActions = quickActionsFor(session.user.modules);

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <header className="border-b border-stone-200 bg-white/90 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 h-12 gap-3">
          {/* Top-left: BrandMark on home, Back arrow on subpages. See
              MobileHeaderBack — one entry point for every child route so we
              stop duplicating "← Back" buttons on individual forms. */}
          <MobileHeaderBack projectId={project.id} />
          <div className="flex-1 min-w-0 text-center">
            <span className="text-sm font-semibold text-stone-900 tracking-tight truncate block">
              <span className="text-stone-500 font-normal">Project: </span>
              {project.name}
            </span>
          </div>
          <span className="text-[11px] text-stone-500 truncate max-w-[80px]">
            {session.user.name?.split(" ")[0] ?? session.user.username}
          </span>
        </div>
      </header>
      {/* Bottom padding is the sum of the fixed nav's height (~60px) AND
          the iPhone home-indicator safe area — pb-20 (80px) was leaving the
          last ~10-15px of every screen UNDER the nav on iPhones with a
          home bar, so tapping a Submit button near the bottom hit the Home
          tab instead and sent the engineer back to the project home. This
          also explains the "some buttons need a double-tap" complaint:
          first tap → accidental Home nav, second tap → real target. */}
      <main
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {/* Push-notification opt-in — hides itself when permission is
            already granted or denied, or when previously dismissed. */}
        <PushOptIn />
        {/* Zero-render helper — refreshes the bell badge when the tab
            becomes visible again after being backgrounded. Debounced
            to at most one refresh every 15s. */}
        <BellAutoRefresh />
        <div className="px-4 pt-2 flex justify-center">
          <PendingSyncBadge />
        </div>
        {children}
      </main>
      <div
        className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-white border-t border-stone-200"
        style={{ boxShadow: "0 -2px 8px rgba(28, 25, 23, 0.04)" }}
      >
        <MobileBottomNav
          projectId={project.id}
          pendingActions={pendingActions}
          unreadNotifications={unreadNotifications}
        />
      </div>
      {/* Central "+" FAB above the bottom nav — one tap opens a sheet of
          the day's most-used log actions. Rendered only when the user has
          at least one accessible action (scoped users with none see no
          FAB, which keeps the chrome honest). */}
      <QuickAddFab projectId={project.id} actions={quickActions} />
      {/* First-run 3-slide tour. Renders nothing after the engineer has
          dismissed it once (localStorage-gated on the device). */}
      <MobileOnboarding />
    </div>
  );
}
