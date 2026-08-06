"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import styles from "./detailDrawer.module.css";

export interface DetailDrawerProps {
  /** Presence controls open state. Undefined = closed. */
  open: boolean;
  /** Called when the drawer wants to close (backdrop click, X, Escape). */
  onClose: () => void;
  /** Short label at top of drawer header, e.g. "Villa · drill-down". */
  eyebrow?: string;
  /** Prominent title, e.g. "Villa 12" or "Block 9". */
  title: string;
  /** Optional subtitle under the title. */
  subtitle?: string;
  /** Panel content (server-rendered or client-rendered). */
  children: React.ReactNode;
}

/**
 * Generic right-side slide-in drawer. Used by the Dashboard + Layout tabs to
 * drill into a villa or block. Fully accessible: role=dialog, aria-modal,
 * focus trap, Escape close, backdrop close, focus restoration on close.
 *
 * State model: parent controls open/close. Typically wired to URL search
 * params so drawers are refreshable / shareable / browser-back closes them.
 */
export default function DetailDrawer({
  open, onClose, eyebrow, title, subtitle, children,
}: DetailDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus management + Escape + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") trapFocus(e, dialogRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`${styles.scrim} ${open ? styles.scrimOpen : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={dialogRef}
        className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-drawer-title"
        aria-hidden={!open}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
            <h2 id="detail-drawer-title" className={styles.title}>{title}</h2>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <button
            ref={closeBtnRef}
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X className={styles.closeIcon} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </>
  );
}

/**
 * URL-driven variant — auto-derives open/close from a specific search param.
 * Parent renders <UrlDetailDrawer param="vd" ...>; when ?vd=... appears in
 * the URL, drawer opens. Clicking close removes the param.
 */
export function UrlDetailDrawer(props: Omit<DetailDrawerProps, "onClose"> & { param: string }) {
  const router = useRouter();
  const onClose = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete(props.param);
    router.replace(url.pathname + (url.search ? url.search : ""), { scroll: false });
  };
  return <DetailDrawer {...props} onClose={onClose} />;
}

function trapFocus(e: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
