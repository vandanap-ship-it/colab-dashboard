"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Bell, BellRing } from "lucide-react";

type Notification = {
  id: string;
  title: string;
  body?: string;
  href?: string;
  createdAt: string;
};

/**
 * Live notifications backend doesn't exist yet (slated for v1.1). For now this
 * is a visual placeholder: bell + zero-state dropdown. We'll wire it up to a
 * real /api/notifications endpoint once we model the events.
 */
export default function NotificationBell() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [items] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!session?.user) return null;

  const unread = items.length;
  const Icon = unread > 0 ? BellRing : Bell;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative w-9 h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-600 hover:text-stone-900 transition-colors"
      >
        <Icon className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center px-1 ring-2 ring-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-stone-200 bg-white shadow-elevated z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Notifications</h3>
            {unread > 0 && (
              <span className="text-xs text-stone-500">
                {unread} unread
              </span>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-sm text-stone-500 text-center">
              <Bell className="w-8 h-8 text-stone-300 mx-auto mb-3" />
              You&apos;re all caught up.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-stone-100">
              {items.map((n) => (
                <li key={n.id} className="px-4 py-3 hover:bg-stone-50">
                  <div className="text-sm font-medium text-stone-900">{n.title}</div>
                  {n.body && (
                    <div className="text-xs text-stone-500 mt-0.5">{n.body}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
