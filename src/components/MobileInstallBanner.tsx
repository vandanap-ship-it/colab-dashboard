"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * "Install Siddhi to your phone" nudge for the mobile app.
 *
 * The web app manifest (src/app/manifest.ts) already declares Siddhi as
 * installable with display:"standalone". This banner just makes that
 * capability visible to users who otherwise wouldn't hunt for Chrome's
 * "Add to Home Screen" menu.
 *
 * Behaviour per platform:
 *   - Chrome Android or Desktop:
 *       Browser fires `beforeinstallprompt`. We capture the event and,
 *       when the user taps the banner's "Install" CTA, call `.prompt()`
 *       on it — the browser then shows its own native install dialog.
 *       After a successful install, the browser fires `appinstalled`,
 *       we hide the banner permanently.
 *   - iOS Safari:
 *       `beforeinstallprompt` is NOT supported. We detect Safari on
 *       iOS and show 3-line manual instructions instead (Share → Add
 *       to Home Screen).
 *   - Already installed (standalone display mode):
 *       Hide entirely. No banner.
 *
 * Anti-nag rules:
 *   - Dismissed via the X → hidden for 14 days on that device.
 *   - Successfully installed → hidden forever on that device.
 *   - localStorage failures (Safari private mode) are swallowed — the
 *     banner just doesn't remember the choice, better than throwing.
 *
 * Kept in its own component + own storage keys so the change is fully
 * contained. Nothing else on the page needs to know it exists.
 */

const DISMISS_KEY = "siddhi-install-banner-dismissed-until";
const INSTALLED_KEY = "siddhi-install-banner-installed";
const DISMISS_DAYS = 14;

// Chrome's beforeinstallprompt event shape (not in lib.dom yet).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Chrome / Android / desktop use display-mode; iOS Safari uses navigator.standalone.
  const dm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // navigator.standalone is iOS Safari only, not in lib.dom.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return dm || iosStandalone;
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPhone/iPad + Safari (not Chrome-on-iOS which has "CriOS")
  return /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export default function MobileInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Bail immediately if already installed or previously dismissed within window.
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(INSTALLED_KEY) === "1") return;
      const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || "0");
      if (dismissedUntil && Date.now() < dismissedUntil) return;
    } catch {
      // Private mode / quota — proceed as if not dismissed.
    }

    const isIos = isIosSafari();
    setIos(isIos);

    if (isIos) {
      // iOS Safari: no beforeinstallprompt event, show anyway with manual hint.
      setVisible(true);
      return;
    }

    // Chrome / other browsers: wait for the native event before showing.
    // If it never fires (older browser, unsupported context), the banner
    // stays hidden — that's the correct behaviour, no install is possible.
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    function onInstalled() {
      try { localStorage.setItem(INSTALLED_KEY, "1"); } catch {}
      setVisible(false);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    setShowIosHint(false);
    try {
      localStorage.setItem(
        DISMISS_KEY,
        String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
      );
    } catch {}
  }

  async function install() {
    if (ios) {
      setShowIosHint(true);
      return;
    }
    if (!promptEvent) return;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        try { localStorage.setItem(INSTALLED_KEY, "1"); } catch {}
        setVisible(false);
      }
    } catch {
      // User dismissed the browser's native prompt — leave our banner
      // visible so they can try again if they change their mind.
    }
  }

  if (!visible) return null;

  return (
    <div className="mx-4 mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
      <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0">
        <Download className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        {showIosHint ? (
          <>
            <p className="text-sm font-medium text-amber-900">Add Siddhi to your home screen</p>
            <ol className="mt-1 text-xs text-amber-800 leading-relaxed list-decimal pl-4">
              <li>Tap the Share button at the bottom of Safari.</li>
              <li>Scroll and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b> in the top-right.</li>
            </ol>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-amber-900">
              Install Siddhi on this phone
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              One tap, no browser bars, just like a regular app.
            </p>
            <button
              type="button"
              onClick={install}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900 text-white text-xs font-medium px-3 py-1.5 active:scale-[0.98] transition-all"
            >
              {ios ? "Show me how" : "Install"}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="p-1 -mr-1 -mt-1 rounded text-amber-700/70 hover:text-amber-900"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
