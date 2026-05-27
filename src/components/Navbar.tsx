"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Inbox, Smartphone, ShieldCheck, Users, History, Trash2 } from "lucide-react";
import { canSeeMobile, isAdmin } from "@/lib/roles";
import BrandMark from "./BrandMark";
import SwitchProjectButton from "./SwitchProjectButton";
import NotificationBell from "./NotificationBell";
import UserAvatarMenu from "./UserAvatarMenu";

export default function Navbar() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? "";
  const [actionCount, setActionCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/my-actions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setActionCount(d.total));
  }, [session?.user]);

  return (
    <header className="w-full border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-14 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <BrandMark />
          {session?.user && (
            <span className="hidden md:inline-block w-px h-6 bg-stone-200" aria-hidden />
          )}
          {session?.user && <SwitchProjectButton compact />}
        </div>

        <nav className="flex items-center gap-1">
          <NavLink href="/my-actions" icon={<Inbox className="w-4 h-4" />} label="My Actions" badge={actionCount} />
          {isAdmin(role) && (
            <>
              <NavLink href="/admin/users" icon={<Users className="w-4 h-4" />} label="Users" />
              <NavLink href="/admin/contractors" icon={<ShieldCheck className="w-4 h-4" />} label="Contractors" />
              <NavLink href="/admin/audit" icon={<History className="w-4 h-4" />} label="Audit" />
              <NavLink href="/admin/trash" icon={<Trash2 className="w-4 h-4" />} label="Trash" />
            </>
          )}
          {canSeeMobile(role) && (
            <NavLink href="/mobile" icon={<Smartphone className="w-4 h-4" />} label="Mobile" />
          )}
          {session?.user && (
            <div className="flex items-center gap-2 ml-2 pl-3 border-l border-stone-200">
              <NotificationBell />
              <UserAvatarMenu />
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
}) {
  return (
    <Link
      href={href}
      className="relative px-3 py-1.5 rounded-lg text-sm text-stone-700 hover:text-stone-900 hover:bg-stone-50 flex items-center gap-2 transition-colors"
    >
      <span className="text-stone-500">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
      {badge != null && badge > 0 && (
        <span className="text-[10px] font-bold bg-brand-400 text-stone-900 rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
          {badge}
        </span>
      )}
    </Link>
  );
}
