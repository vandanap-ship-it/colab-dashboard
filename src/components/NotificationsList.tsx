"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  tag: string | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * Mobile Notifications inbox. Client component because the list mutates
 * in place on tap (mark-as-read + navigate) and on the "Mark all as
 * read" affordance. Load-on-mount → fresh fetch; the parent server
 * component doesn't try to prefetch because the read state changes
 * every tap and we'd immediately re-render.
 */
export default function NotificationsList() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=100", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const j = await res.json();
      setItems(j.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load notifications");
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget load on mount — the setState inside `load` runs
    // asynchronously after the fetch resolves, so the "sync setState in
    // effect" rule fires as a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const markOne = useCallback(async (id: string) => {
    // Optimistic — update UI first, roll back on failure. Bell badge
    // count refreshes via router.refresh() so the layout's server-side
    // count query re-runs.
    const before = items;
    setItems((prev) =>
      prev?.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) ?? null,
    );
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch {
      setItems(before);
    }
  }, [items, router]);

  const markAll = useCallback(async () => {
    if (markingAll) return;
    setMarkingAll(true);
    const before = items;
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((n) => (n.readAt ? n : { ...n, readAt: now })) ?? null);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } catch {
      setItems(before);
    } finally {
      setMarkingAll(false);
    }
  }, [items, markingAll, router]);

  if (error) {
    return (
      <div className="px-5 py-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="px-5 py-16 text-center">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
        <p className="mt-2 text-xs text-stone-500">Loading notifications…</p>
      </div>
    );
  }

  const unread = items.filter((n) => !n.readAt);

  return (
    <div className="px-5 py-5">
      <header className="mb-4">
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">Inbox</p>
        <h1 className="font-serif text-[28px] leading-tight text-ink mt-1">Notifications</h1>
        <p className="text-[13px] text-ink-3 mt-1">
          Every ping the app has sent you — WIRs assigned, RFIs answered, permits reviewed. Tap
          one to open the thing it&apos;s about; tap the check to mark it read without
          navigating.
        </p>
      </header>

      {unread.length > 0 && (
        <button
          type="button"
          onClick={markAll}
          disabled={markingAll}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-ink text-cream text-[13px] font-semibold px-4 py-2 shadow-card disabled:opacity-60"
        >
          <Check className="w-3.5 h-3.5" />
          {markingAll ? "Marking…" : `Mark ${unread.length} as read`}
        </button>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl bg-sandstone-100/60 border border-sandstone-200 px-6 py-10 text-center">
          <BellOff className="w-6 h-6 text-ink-3 mx-auto mb-2" />
          <p className="text-[14px] text-ink-3 leading-snug">
            Nothing here yet — this is where new pings will show up.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white overflow-hidden">
          {items.map((n) => (
            <li key={n.id} className={n.readAt ? "bg-white" : "bg-sandstone-50/60"}>
              <NotificationRow n={n} onMark={markOne} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ n, onMark }: { n: Notification; onMark: (id: string) => void }) {
  const unread = !n.readAt;
  const time = new Date(n.createdAt);
  const ago = timeAgo(time);

  // The row body is a Link when we have a URL, and marks-as-read as a
  // side-effect. The check button is a separate control so an engineer
  // can dismiss without navigating.
  const rowContent = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-1 flex-shrink-0">
        <Bell className={`w-4 h-4 ${unread ? "text-ferrous-500" : "text-stone-400"}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] leading-snug ${unread ? "font-semibold text-ink" : "text-ink-2"}`}>
          {n.title}
        </div>
        <div className="text-[13px] text-ink-3 mt-0.5 leading-snug">{n.body}</div>
        <div className="text-[11px] text-ink-3 mt-1 uppercase tracking-[0.1em]">{ago}</div>
      </div>
      {unread && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMark(n.id);
          }}
          className="flex-shrink-0 rounded-full p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100"
          aria-label="Mark read"
        >
          <Check className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  if (n.url) {
    return (
      <Link href={n.url} onClick={() => onMark(n.id)} className="block">
        {rowContent}
      </Link>
    );
  }
  return <div>{rowContent}</div>;
}

function timeAgo(then: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
