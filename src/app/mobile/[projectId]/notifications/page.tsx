import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import NotificationsList from "@/components/NotificationsList";

/**
 * Notifications inbox — landing page for the bell in the mobile bottom
 * nav. Server component is a thin auth wrapper; the list itself is a
 * client component that fetches + mutates state on tap.
 *
 * projectId is unused server-side (notifications are user-scoped, not
 * project-scoped) but the route sits under /mobile/[projectId] to keep
 * the bottom nav's tab layout consistent with everything else.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  const { projectId } = await params;
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/mobile/${projectId}/notifications`)}`);
  }
  return <NotificationsList />;
}
