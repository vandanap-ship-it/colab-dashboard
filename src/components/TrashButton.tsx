"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Shared "move to trash" button used across the list/detail views for
 * hindrances, concerns, snags, RFIs, manpower entries, and contractors.
 *
 * Two-step confirm before the DELETE call fires so a stray tap can't
 * silently remove a record. On success, `onDeleted` fires so the parent
 * can drop the row from state without a full refetch. Records land in
 * /admin/trash and are restorable via /api/admin/restore.
 *
 * For contractors (which soft-delete via `active: false` rather than
 * `deletedAt`) the same button works because the server-side DELETE
 * handler abstracts the mechanism.
 */

export interface TrashButtonProps {
  /** DELETE target — e.g. "/api/hindrances/abc123". */
  url: string;
  /** Human-readable noun for the confirm/undo prompts ("hindrance", "snag"). */
  kind: string;
  /** Short label of the row being removed, shown in the confirm dialog. */
  label?: string;
  /** Called after a successful DELETE. When omitted, the component falls
   *  back to `router.refresh()` — the right default for Server Components
   *  that render lists straight from Prisma and can't easily pass a
   *  client callback across the RSC boundary. */
  onDeleted?: () => void;
  /** Optional tooltip text override. */
  title?: string;
  /** Optional label text next to the icon. Defaults to icon-only. */
  showLabel?: boolean;
}

export default function TrashButton({
  url,
  kind,
  label,
  onDeleted,
  title,
  showLabel = false,
}: TrashButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const msg = label
      ? `Move this ${kind} to trash?\n\n"${label.length > 80 ? label.slice(0, 80) + "…" : label}"\n\nYou can restore it from Admin → Trash.`
      : `Move this ${kind} to trash? You can restore it from Admin → Trash.`;
    if (!window.confirm(msg)) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || `Delete failed (HTTP ${res.status})`);
        setPending(false);
        return;
      }
      // Successful — let the parent choose how to refresh, or fall back
      // to router.refresh() for server-rendered lists that can't pass a
      // client callback across the RSC boundary.
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={title ?? `Move ${kind} to trash`}
      aria-label={title ?? `Move ${kind} to trash`}
      className={
        "inline-flex items-center gap-1 rounded-md border border-transparent text-stone-400 hover:text-red-700 hover:bg-red-50 hover:border-red-200 px-1.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" +
        (err ? " text-red-700 border-red-300" : "")
      }
    >
      <Trash2 className="w-3.5 h-3.5" aria-hidden />
      {showLabel && <span className="text-xs">{pending ? "Removing…" : err ? "Retry" : "Trash"}</span>}
    </button>
  );
}
