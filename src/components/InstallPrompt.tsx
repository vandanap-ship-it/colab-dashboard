"use client";

import { useEffect, useState } from "react";

// Prompts the user to add Siddhi to their home screen.
//
// Android / Chrome: listens for `beforeinstallprompt`; on show, taps Install
// button fire the browser's native install prompt.
// iOS Safari: no beforeinstallprompt — we show a static "Tap Share → Add to
// Home Screen" hint instead.
// Standalone PWA: hidden (already installed).
// Dismissed: hidden for 7 days (localStorage flag with timestamp).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "siddhi-install-dismissed-at";
const DISMISS_DAYS = 7;

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed → never show.
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // On a desktop / laptop → never show.
    if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    // Recently dismissed → skip.
    try {
      const dismissedAt = window.localStorage.getItem(DISMISS_KEY);
      if (dismissedAt) {
        const ageDays = (Date.now() - Number(dismissedAt)) / 86400000;
        if (ageDays < DISMISS_DAYS) return;
      }
    } catch {
      // ignore storage errors
    }

    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIOS(ios);
    if (ios) {
      setVisible(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") dismiss();
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 rounded-xl border border-stone-200 bg-white/95 backdrop-blur px-4 py-3 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-stone-900">Add Siddhi to home screen</div>
          <div className="text-xs text-stone-600 mt-1 leading-relaxed">
            {isIOS
              ? "Tap the Share icon in Safari, then Add to Home Screen."
              : "One-tap access for daily progress logs."}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 text-2xl leading-none text-stone-400 hover:text-stone-900 -mt-1"
        >
          ×
        </button>
      </div>
      {!isIOS && prompt && (
        <button
          type="button"
          onClick={install}
          className="mt-3 w-full rounded-lg bg-charcoal text-white text-sm font-medium py-2.5 hover:bg-stone-800 active:scale-[0.98] transition"
        >
          Install
        </button>
      )}
    </div>
  );
}
