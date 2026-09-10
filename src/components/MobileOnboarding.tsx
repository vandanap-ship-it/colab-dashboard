"use client";

import { useEffect, useState } from "react";
import { Home, Inbox, FolderClosed, User, X, ArrowRight } from "lucide-react";

/**
 * First-run 3-slide overlay explaining the mobile nav to a site engineer
 * opening Siddhi for the first time. Shown once per device — dismissal
 * writes a flag to localStorage so the same phone doesn't see it again.
 *
 * Storage key is versioned (`-v1`) so if we later want to re-onboard
 * everyone (new nav item, redesign) we bump the suffix.
 *
 * Behaviour on Safari private mode or when localStorage throws: fails
 * gracefully — the overlay just doesn't remember being dismissed, so
 * the engineer sees it again next session. Better than swallowing the
 * error and never showing it.
 */
const SEEN_KEY = "siddhi-mobile-onboarding-seen-v1";

interface Slide {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}
const SLIDES: Slide[] = [
  {
    icon: Home,
    title: "Home — your daily starting point",
    body: "Log progress, manpower, hindrances, and work permits from here. New Progress is the big black button — the first thing most engineers tap every morning.",
  },
  {
    icon: Inbox,
    title: "Info — what's waiting on you",
    body: "Concerns assigned to you, open snags, inspections to review. The number badge on the Info tab tells you how many items need attention.",
  },
  {
    icon: FolderClosed,
    title: "Documents & Profile",
    body: "Documents has every permit, checklist, and record template you'll need on site. Profile is your account and sign-out.",
  },
];

export default function MobileOnboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen) setVisible(true);
    } catch {
      // localStorage blocked (private mode / quota). Show anyway; won't remember.
      setVisible(true);
    }
  }, []);

  function markSeenAndClose() {
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      // Ignore — same graceful fallback as read.
    }
    setVisible(false);
  }

  if (!visible) return null;
  const slide = SLIDES[step];
  const Icon = slide.icon;
  const isLast = step === SLIDES.length - 1;

  return (
    // Full-screen dimmer + centred card. z-40 so it sits above the bottom
    // nav (z-20 in the mobile layout header/nav) without stealing the
    // Skip button's tap events.
    <div
      className="fixed inset-0 z-40 bg-stone-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-stone-100">
          <span className="text-[10px] uppercase tracking-widest text-stone-500">
            Getting started · {step + 1} / {SLIDES.length}
          </span>
          <button
            type="button"
            onClick={markSeenAndClose}
            aria-label="Skip"
            className="p-1.5 -mr-1.5 rounded-full text-stone-400 hover:text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-6 text-center">
          <span className="inline-flex w-14 h-14 rounded-full bg-brand-50 text-brand-700 items-center justify-center mb-4">
            <Icon className="w-7 h-7" />
          </span>
          <h2 id="onb-title" className="text-lg font-semibold text-stone-900">
            {slide.title}
          </h2>
          <p className="mt-2 text-sm text-stone-600 leading-relaxed">
            {slide.body}
          </p>
        </div>

        <div className="flex items-center justify-between px-4 pb-4">
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${
                  i === step ? "bg-stone-900" : "bg-stone-300"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => (isLast ? markSeenAndClose() : setStep(step + 1))}
            className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white text-sm font-medium px-5 py-2 hover:bg-stone-800"
          >
            {isLast ? "Got it" : "Next"}
            {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="px-4 pb-4 text-center">
          {/* Profile → Reset "Getting started" hint isn't wired yet;
              intentionally left as a follow-up so this launch keeps its
              blast radius small. Users can always clear browser storage
              to re-see the overlay. */}
          <p className="text-[10px] text-stone-400">
            One-time tour. You can find help in the User Guide anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
