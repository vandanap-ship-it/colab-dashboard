"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderClosed, Inbox, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export default function MobileBottomNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const items: { href: string; label: string; icon: LucideIcon }[] = [
    { href: `/mobile/${projectId}`, label: "Home", icon: Home },
    { href: `/mobile/${projectId}/documents`, label: "Documents", icon: FolderClosed },
    { href: `/mobile/${projectId}/info`, label: "Info", icon: Inbox },
    { href: `/mobile/${projectId}/profile`, label: "Profile", icon: User },
  ];

  return (
    <nav
      className="border-t border-stone-200 bg-white grid grid-cols-4"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((it) => {
        const active =
          pathname === it.href ||
          (it.href !== `/mobile/${projectId}` && pathname.startsWith(it.href));
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className="relative flex flex-col items-center justify-center py-2.5 transition-colors"
          >
            {active && (
              <span
                aria-hidden
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand-500 rounded-full"
              />
            )}
            <Icon
              className={`w-5 h-5 ${active ? "text-stone-900" : "text-stone-400"}`}
              strokeWidth={active ? 2.25 : 2}
            />
            <span
              className={`mt-1 text-[10px] font-medium ${
                active ? "text-stone-900" : "text-stone-500"
              }`}
            >
              {it.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
