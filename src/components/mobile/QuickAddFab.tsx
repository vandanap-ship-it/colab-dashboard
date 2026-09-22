"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  Plus,
  X,
  PlusCircle,
  Users,
  AlertTriangle,
  MessageSquare,
  ClipboardList,
  HelpCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { QuickAddKey } from "@/lib/quickActions";

// Re-export so existing `import { QuickAddKey } from "@/components/mobile/QuickAddFab"`
// sites keep working. Canonical definition lives in the lib now so the
// server-side gating and the golden tests share one source of truth.
export type { QuickAddKey };

/**
 * Central "+" FAB that opens a bottom sheet with the day's most-used actions.
 * Saves a tap on the pattern "home → find tile → tap new" — from anywhere in
 * the mobile app, one tap opens the sheet, second tap is the intent.
 *
 * The FAB sits above the bottom nav; when open, the sheet slides in from the
 * bottom and a scrim dims everything behind it. Escape and tapping the scrim
 * both dismiss. Body scroll is locked while the sheet is open so the rows
 * behind don't wobble under a finger.
 *
 * The parent (layout) decides which actions to expose — a scoped contractor
 * with only HINDRANCE might see just "Add hindrance" — so the sheet renders
 * only the keys it's given.
 */
export default function QuickAddFab({
  projectId,
  actions,
}: {
  projectId: string;
  actions: readonly QuickAddKey[];
}) {
  const [open, setOpen] = useState(false);

  // Lock scroll while the sheet is open — otherwise the finger dragging on
  // the scrim scrolls the page behind. `document.body` isn't available at
  // module load time (RSC pre-render), so guard for it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Escape to close — small quality-of-life for external-keyboard users.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const items = ACTION_ITEMS.filter((a) => actions.includes(a.key)).map((a) => ({
    ...a,
    href: a.hrefFor(projectId),
  }));
  if (items.length === 0) return null;

  return (
    <>
      {/* FAB — sits centrally above the bottom nav. Uses fixed positioning
          so it stays put as content scrolls. */}
      <button
        type="button"
        aria-label={open ? "Close quick add" : "Quick add"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-14 left-1/2 -translate-x-1/2 z-30 w-14 h-14 rounded-full bg-ferrous-500 text-white flex items-center justify-center active:scale-95 transition-transform"
        style={{
          marginBottom: "env(safe-area-inset-bottom)",
          boxShadow: "0 10px 24px rgba(184, 62, 34, 0.28), 0 4px 8px rgba(28, 25, 23, 0.12)",
        }}
      >
        {open ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </button>

      {/* Scrim + sheet — rendered only when open so the DOM stays clean.
          The scrim eats clicks and closes the sheet. */}
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-ink/40 backdrop-blur-[2px]"
          />
          <div
            role="dialog"
            aria-label="Quick add"
            className="fixed left-1/2 -translate-x-1/2 bottom-0 max-w-md w-full z-40 rounded-t-3xl bg-ivory border-t border-sandstone-100"
            style={{
              paddingBottom: "calc(env(safe-area-inset-bottom) + 88px)",
              boxShadow: "0 -12px 32px rgba(28, 25, 23, 0.18)",
            }}
          >
            <div className="pt-3 flex justify-center">
              <span aria-hidden className="w-10 h-1 rounded-full bg-sandstone-200" />
            </div>
            <div className="px-5 pt-3 pb-5">
              <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
                Log something
              </p>
              <h2 className="font-serif text-[22px] leading-tight text-ink mt-0.5">
                What are you doing?
              </h2>
              <ul className="mt-4 space-y-2">
                {items.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.key}>
                      <Link
                        href={a.href}
                        onClick={() => setOpen(false)}
                        className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-4 flex items-center gap-4 active:scale-[0.99] transition-transform"
                      >
                        <span className="w-11 h-11 rounded-full bg-ferrous-50 text-ferrous-600 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[16px] font-semibold text-ink leading-tight">
                            {a.label}
                          </div>
                          <div className="text-[12.5px] text-ink-3 mt-0.5">
                            {a.hint}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Action registry — one place so labels / hints / hrefs stay consistent with
// the home tiles. The layout picks which keys to show based on the user's
// module access.
// ---------------------------------------------------------------------------

const ACTION_ITEMS: readonly {
  key: QuickAddKey;
  label: string;
  hint: string;
  icon: LucideIcon;
  hrefFor: (projectId: string) => string;
}[] = [
  {
    key: "log-progress",
    label: "Log progress",
    hint: "Percent complete + labour on an activity",
    icon: PlusCircle,
    hrefFor: (p) => `/mobile/${p}/progress/new`,
  },
  {
    key: "log-manpower",
    label: "Log manpower",
    hint: "Trades and headcount on site today",
    icon: Users,
    hrefFor: (p) => `/mobile/${p}/manpower/new`,
  },
  {
    key: "raise-wir",
    label: "Raise a WIR",
    hint: "Work Inspection Request — pass this activity",
    icon: ClipboardList,
    hrefFor: (p) => `/mobile/${p}/inspection/new`,
  },
  {
    key: "add-hindrance",
    label: "Add hindrance",
    hint: "Blocker holding an activity up",
    icon: AlertTriangle,
    hrefFor: (p) => `/mobile/${p}/hindrance/new`,
  },
  {
    key: "add-concern",
    label: "Add concern",
    hint: "Heads-up for leadership",
    icon: MessageSquare,
    hrefFor: (p) => `/mobile/${p}/concern/new`,
  },
  {
    key: "raise-rfi",
    label: "Raise an RFI",
    hint: "Ask consultants for a decision",
    icon: HelpCircle,
    hrefFor: (p) => `/mobile/${p}/rfi/new`,
  },
];
