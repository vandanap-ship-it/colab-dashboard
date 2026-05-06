"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { ROLE_LABELS } from "@/lib/roles";

function initials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default function UserAvatarMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!session?.user) return null;

  const name = session.user.name ?? session.user.username;
  const firstName = name?.split(/\s+/)[0] ?? name;
  const role = session.user.role;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 hover:bg-stone-100 rounded-lg px-1.5 py-1 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-8 h-8 rounded-full bg-stone-900 text-white flex items-center justify-center text-xs font-semibold ring-2 ring-stone-100">
          {initials(name)}
        </span>
        <span className="hidden md:flex flex-col items-start leading-tight pr-1">
          <span className="text-sm font-medium text-stone-900">Hi, {firstName}</span>
          <span className="text-[10px] text-stone-500">@{session.user.username}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 hidden md:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl border border-stone-200 bg-white shadow-elevated z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-stone-900 text-white flex items-center justify-center text-sm font-semibold">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-stone-900 truncate">{name}</div>
              <div className="text-[11px] text-stone-500 truncate">
                @{session.user.username} · {ROLE_LABELS[role] ?? role}
              </div>
            </div>
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-900"
            role="menuitem"
          >
            <UserIcon className="w-4 h-4 text-stone-400" />
            Profile
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: "/login" });
            }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-900 text-left border-t border-stone-100"
            role="menuitem"
          >
            <LogOut className="w-4 h-4 text-stone-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
