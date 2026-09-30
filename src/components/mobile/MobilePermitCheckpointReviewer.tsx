"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, MessageSquare, X, Loader2 } from "lucide-react";

/**
 * Colab-parity per-checkpoint reviewer controls on the mobile permit
 * detail. Only rendered when the viewer is a listed approver and the
 * permit is still PENDING. Icons on the right — 💬 comment, 📷 photo,
 * plus an inline "↩ Add Reply" pill when the reviewer hasn't left a
 * note yet. Mirrors the WIR reviewer row so the site team's muscle
 * memory carries between modules.
 *
 * State is optimistic: on save the local `note` / `photoUrl` bind
 * updates immediately; the router.refresh() then re-fetches server
 * state so a concurrent reviewer's write comes through on the next
 * paint.
 */
export default function MobilePermitCheckpointReviewer({
  permitId,
  index,
  initialNote,
  initialPhotoUrl,
}: {
  permitId: string;
  index: number;
  initialNote: string | null;
  initialPhotoUrl: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(initialNote ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl ?? "");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    if (saving) return; // guard against double-click racing the fetch
    setSaving(true);
    setError(null);
    const trimmed = note.trim();
    try {
      const res = await fetch(`/api/work-permits/${permitId}/checkpoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, reviewerNote: trimmed || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      }
      setNoteEditorOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("scope", `permit-checkpoint-review-${permitId}`);
      fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) {
        const data = await up.json().catch(() => null);
        setError(data?.error ?? `Upload failed (${up.status})`);
        return;
      }
      const { urls } = (await up.json()) as { urls: string[] };
      const url = urls[0];
      if (!url) {
        setError("Upload returned no URL");
        return;
      }
      const res = await fetch(`/api/work-permits/${permitId}/checkpoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, reviewerPhotoUrl: url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      }
      setPhotoUrl(url);
      startTransition(() => router.refresh());
    } finally {
      setUploading(false);
    }
  }

  async function clearPhoto() {
    setError(null);
    try {
      const res = await fetch(`/api/work-permits/${permitId}/checkpoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, reviewerPhotoUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Clear failed (${res.status})`);
        return;
      }
      setPhotoUrl("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    }
  }

  const hasNote = note.trim().length > 0;

  return (
    <div className="space-y-1.5 mt-2">
      {hasNote && !noteEditorOpen && (
        <p className="text-[12px] text-ink bg-sandstone-50 rounded-md px-2 py-1 border border-sandstone-100 whitespace-pre-wrap">
          <span className="text-[10px] font-semibold text-ferrous-600 uppercase tracking-wider mr-1.5">
            Approver
          </span>
          {note}
        </p>
      )}

      {noteEditorOpen && (
        <div className="rounded-md border-2 border-dashed border-amber-300 bg-white p-2 space-y-2">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Approver comment"
            className="w-full min-h-16 bg-transparent text-sm outline-none resize-y"
            maxLength={2000}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNoteEditorOpen(false);
                setNote(initialNote ?? "");
                setError(null);
              }}
              className="text-xs font-semibold text-stone-500 px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={isPending || saving}
              className="text-xs font-semibold rounded-md bg-ferrous-500 text-white px-3 py-1 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {photoUrl && (
        <div className="flex items-center gap-2">
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block w-12 h-12 rounded-md overflow-hidden border border-stone-200 bg-stone-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Approver photo" className="w-full h-full object-cover" loading="lazy" />
          </a>
          <button
            type="button"
            onClick={clearPhoto}
            aria-label="Remove approver photo"
            className="text-stone-400 hover:text-stone-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">{error}</p>
      )}

      <div className="flex items-center justify-between text-[11px] text-stone-500">
        <span className="font-semibold text-ink">Approver</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNoteEditorOpen((v) => !v)}
            aria-label={hasNote ? "Edit approver comment" : "Add approver comment"}
            className="text-ink hover:text-ferrous-600"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <label
            aria-label={photoUrl ? "Replace approver photo" : "Add approver photo"}
            className={`cursor-pointer ${uploading ? "text-stone-300" : "text-ink hover:text-ferrous-600"}`}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
                e.currentTarget.value = "";
              }}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {!hasNote && !noteEditorOpen && (
        <button
          type="button"
          onClick={() => setNoteEditorOpen(true)}
          className="w-full rounded-md border border-ink text-sm font-semibold text-ink py-2 hover:bg-sandstone-50"
        >
          ↩ Add Reply
        </button>
      )}
    </div>
  );
}
