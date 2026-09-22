"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Pencil } from "lucide-react";

/**
 * Draft-only bottom bar on the WIR detail page. Currently one action:
 * Delete draft. The existing DELETE /api/inspections/[id] endpoint
 * already gates on "filler or admin", so this bar only wires up the
 * confirmation flow — a two-tap gate so a stray thumb-tap doesn't wipe
 * work the filler cared about.
 *
 * Resume-editing is a follow-up (would need a new /inspection/edit/[id]
 * route + a PUT endpoint that replaces items in place). For now the
 * filler either finishes the draft in a fresh WIR (using their own
 * memory of what they'd already answered) or deletes and starts over.
 */
export default function MobileQaqcDraftActions({
  inspectionId,
  projectId,
  title,
}: {
  inspectionId: string;
  projectId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);

  async function del() {
    setError(null);
    setDeleting(true);
    let res: Response;
    try {
      res = await fetch(`/api/inspections/${inspectionId}`, { method: "DELETE" });
    } catch {
      setDeleting(false);
      setError("Network error — please try again.");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDeleting(false);
      setError(data?.error ?? "Failed to delete.");
      return;
    }
    // Land on the Drafts tab so the filler sees the deletion in
    // context. router.push + refresh so the badge count updates
    // immediately, not on the next natural nav.
    startTransition(() => {
      router.push(`/mobile/${projectId}/qaqc?tab=drafts`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}
      {!confirmOpen ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isPending || deleting}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 bg-white text-stone-800 text-sm font-semibold py-3 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
            Delete draft
          </button>
          <Link
            href={`/mobile/${projectId}/inspection/edit/${inspectionId}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-cream text-sm font-semibold py-3"
          >
            <Pencil className="w-4 h-4" />
            Continue editing
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
          <p className="text-sm text-stone-700 leading-snug">
            Delete “{title}”? This can’t be undone from the phone — an admin can
            still restore it from the desktop trash.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); setError(null); }}
              disabled={deleting}
              className="rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold py-2 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={del}
              disabled={deleting || isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 text-white text-sm font-semibold py-2 disabled:opacity-60"
            >
              {deleting || isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
