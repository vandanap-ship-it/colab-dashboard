"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";

/**
 * "How to read this dashboard" — a collapsible one-line-per-metric
 * glossary at the top of the Dashboard tab. Direct answer to Shraddha's
 * "how do I explain this to someone" complaint: someone she's walking
 * through the tool can open this, read it in 30 seconds, and know what
 * every headline number means without her having to narrate.
 *
 * Collapsed by default so it doesn't add noise for the daily-driver.
 * Expand state persists per-viewer in localStorage (key includes -v1 so
 * a future rewrite can re-collapse the world). Safari private mode and
 * quota errors are swallowed — the legend just doesn't remember state
 * that session; better than throwing.
 */
const STORAGE_KEY = "siddhi-dashboard-legend-open-v1";

const ITEMS: { term: string; def: string }[] = [
  {
    term: "Total Delay",
    def: "Days behind the baseline finish. Positive = late, 0 = on track, negative = ahead.",
  },
  {
    term: "Projected Handover",
    def: "When we currently expect to finish, based on progress logged so far. Compare to planned.",
  },
  {
    term: "Active Hindrances",
    def: "Blockers site engineers logged that are still open. Zero is the healthy state.",
  },
  {
    term: "Critical Blocks",
    def: "Blocks running more than 30 days behind baseline. These need immediate escalation.",
  },
  {
    term: "Daily Manpower",
    def: "Today's site headcount vs the planned target. Green = on/above plan, amber = below.",
  },
  {
    term: "On-Time Probability",
    def: "High / Medium / Low likelihood we hit the RERA date given current trajectory.",
  },
  {
    term: "RERA Delay",
    def: "Days between projected finish and the RERA-committed date. Positive = late vs RERA.",
  },
  {
    term: "Physical Progress",
    def: "Duration-weighted % across activities that have started. Master Report uses the same math.",
  },
];

export default function DashboardLegend() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
    } catch {
      // Ignore — default stays collapsed.
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — see above.
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-stone-50 transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-stone-600">
          <BookOpen className="w-3.5 h-3.5 text-stone-400" />
          How to read this dashboard
        </span>
        <ChevronDown
          className={`w-4 h-4 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <dl className="border-t border-stone-100 px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
          {ITEMS.map((it) => (
            <div key={it.term} className="flex items-baseline gap-2 min-w-0">
              <dt className="text-xs font-semibold text-stone-900 shrink-0 min-w-[10rem]">
                {it.term}
              </dt>
              <dd className="text-xs text-stone-600 leading-relaxed">{it.def}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
