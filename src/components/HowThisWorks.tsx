"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

/**
 * Inline plain-English walkthrough for a mobile Create form. Kept
 * intentionally patient — Shraddha (Sep 22): the site team needs guidance
 * that's very clear and on-point; more than 3-4 steps is fine as long as
 * every step is obvious.
 *
 * Design decisions:
 *   - Sits inside the form itself (not a separate onboarding page) so
 *     the guidance is right where they need it, when they need it.
 *   - Auto-expanded on first visit per form (via localStorage key),
 *     collapsed on subsequent visits so returning users aren't nagged.
 *   - Header stays visible when collapsed so the walkthrough is
 *     discoverable — no hidden state.
 *   - Role-scoping is implicit: the component lives inside each Create
 *     form, so a user without access to that form never sees it.
 *
 * Callers pass a unique `storageKey` per form so dismissal state is
 * per-form, not global — dismissing the Progress walkthrough doesn't
 * hide the WIR walkthrough.
 */
export default function HowThisWorks({
  title,
  steps,
  storageKey,
}: {
  /** Header text, e.g. "How to log progress". */
  title: string;
  /** One plain-English sentence per step. Numbered automatically. */
  steps: string[];
  /** localStorage key for the collapsed/expanded state. Namespace it
   *  per form: "siddhi.htw.progress", "siddhi.htw.wir", etc. */
  storageKey: string;
}) {
  // Default expanded. On mount we read the stored preference and, if
  // the user has dismissed this walkthrough before, collapse it. This
  // lands on the server as "expanded" so first-render HTML shows the
  // full walkthrough and the effect only trims for returning users.
  const [expanded, setExpanded] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Post-mount hydration read — the SSR pass has to render the full
    // walkthrough expanded (no localStorage on the server), and the
    // effect trims to the collapsed state only on returning visits.
    // Rule flags this correctly as a cascading render; here it's the
    // whole point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "collapsed") setExpanded(false);
    } catch {
      // Private mode / storage disabled — default expanded is the
      // safer choice; the walkthrough is guidance, not a nag.
    }
  }, [storageKey]);

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
      } catch {
        // Same as above — storage failures never break the toggle.
      }
      return next;
    });
  }

  return (
    <section
      // Soft cream card so it reads as a helper strip, not a warning.
      className="rounded-2xl border border-sandstone-200 bg-cream/60 overflow-hidden"
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <HelpCircle className="w-4 h-4 text-ferrous-500 flex-shrink-0" />
        <span className="flex-1 text-[14px] font-semibold text-ink leading-tight">{title}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-ink-3 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-ink-3 flex-shrink-0" />
        )}
      </button>
      {/* On server render `hydrated` is false and `expanded` is true,
          so first paint shows the full walkthrough. Once hydration
          runs, a returning user's collapsed preference kicks in. */}
      {(expanded || !hydrated) && (
        <ol className="px-4 pb-4 pt-1 space-y-1.5 list-none">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] text-ink-2 leading-snug">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-ferrous-500 text-white text-[11px] font-bold font-serif flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
