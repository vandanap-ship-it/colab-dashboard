"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Info, AlertTriangle, AlertCircle, X } from "lucide-react";

/**
 * Toast / snackbar primitive.
 *
 * Replaces the jarring window.alert() popups that used to block the back-nav
 * on Android. Toasts live at the root layout level so a `router.push()`
 * after `toast.success()` doesn't blink the message away — it follows the
 * user to the next page and auto-dismisses there.
 *
 * Variants:
 *   - success → green,   auto-dismiss 3.5s (e.g. "Progress saved")
 *   - info    → blue,    auto-dismiss 4s   (e.g. "Queued — will sync")
 *   - warning → amber,   auto-dismiss 6s   (e.g. "Photos failed to upload")
 *   - error   → red,     sticky (user must dismiss; the message is actionable)
 *
 * Multiple toasts stack at bottom-center on mobile, top-right on md+. The
 * stack is capped at MAX_TOASTS — older ones drop silently if a flood comes in.
 *
 * Accessibility: aria-live="polite" for success/info/warning, "assertive" for
 * error. Screen readers announce as the toast appears.
 */

type ToastVariant = "success" | "info" | "warning" | "error";

type Toast = {
  id: string;
  variant: ToastVariant;
  message: string;
  sticky: boolean;
};

type ShowOptions = { sticky?: boolean; duration?: number };

type ToastApi = {
  show: (variant: ToastVariant, message: string, opts?: ShowOptions) => void;
  success: (message: string, opts?: ShowOptions) => void;
  info: (message: string, opts?: ShowOptions) => void;
  warning: (message: string, opts?: ShowOptions) => void;
  error: (message: string, opts?: ShowOptions) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const MAX_TOASTS = 4;
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3500,
  info: 4000,
  warning: 6000,
  error: 0, // 0 = sticky
};

/**
 * Generate a stable-ish id without depending on crypto.randomUUID — older
 * Android WebViews on non-secure contexts throw on randomUUID. Math.random
 * is fine for ephemeral UI state.
 */
function newId(): string {
  return `t_${Math.random().toString(36).slice(2)}_${performance.now().toString(36)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Keep timer refs so dismiss() can cancel a pending auto-dismiss.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (variant: ToastVariant, message: string, opts: ShowOptions = {}) => {
      const id = newId();
      const sticky = opts.sticky ?? variant === "error";
      setToasts((prev) => {
        const next = [...prev, { id, variant, message, sticky }];
        // Drop oldest if we exceed the cap.
        return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
      });
      if (!sticky) {
        const duration = opts.duration ?? DEFAULT_DURATION[variant];
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
        timersRef.current.set(id, timer);
      }
    },
    [],
  );

  const api: ToastApi = {
    show,
    success: (m, o) => show("success", m, o),
    info: (m, o) => show("info", m, o),
    warning: (m, o) => show("warning", m, o),
    error: (m, o) => show("error", m, o),
    dismiss,
  };

  // Clear all timers on unmount so we don't fire setState on a dead provider.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Read-only hook used outside a provider (rare but legal — toast() becomes a
 * no-op so unit tests / Storybook don't crash).
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // No-op fallback. Logs to console so a developer notices in dev.
  const noop: ToastApi = {
    show: (v, m) => console.warn(`[toast.${v}] outside provider:`, m),
    success: (m) => console.warn("[toast.success] outside provider:", m),
    info: (m) => console.warn("[toast.info] outside provider:", m),
    warning: (m) => console.warn("[toast.warning] outside provider:", m),
    error: (m) => console.warn("[toast.error] outside provider:", m),
    dismiss: () => {},
  };
  return noop;
}

// ---------- presentational ----------

const VARIANT_STYLES: Record<
  ToastVariant,
  { bg: string; border: string; iconBg: string; iconColor: string; icon: typeof Check }
> = {
  success: {
    bg: "bg-white",
    border: "border-emerald-200",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-700",
    icon: Check,
  },
  info: {
    bg: "bg-white",
    border: "border-blue-200",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-700",
    icon: Info,
  },
  warning: {
    bg: "bg-white",
    border: "border-amber-200",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-700",
    icon: AlertTriangle,
  },
  error: {
    bg: "bg-white",
    border: "border-red-200",
    iconBg: "bg-red-100",
    iconColor: "text-red-700",
    icon: AlertCircle,
  },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      // Mobile: bottom-center, above the 64px bottom nav.
      // Desktop: top-right, clear of the header.
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col-reverse items-center gap-2 px-4 sm:bottom-auto sm:right-4 sm:top-4 sm:left-auto sm:inset-x-auto sm:items-end sm:flex-col"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const styles = VARIANT_STYLES[toast.variant];
  const Icon = styles.icon;
  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      // pointer-events-auto on the toast itself so the viewport's
      // pointer-events-none doesn't block tap-to-dismiss.
      className={`pointer-events-auto w-full max-w-sm rounded-lg border ${styles.border} ${styles.bg} shadow-lg ring-1 ring-black/5 overflow-hidden`}
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`flex-shrink-0 rounded-full ${styles.iconBg} ${styles.iconColor} p-1`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="flex-1 text-sm text-stone-800 whitespace-pre-line min-w-0 break-words">
          {toast.message}
        </p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 -m-1 p-1 text-stone-400 hover:text-stone-600 min-h-11 min-w-11 flex items-center justify-center"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
