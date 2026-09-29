"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, MessageSquare, X, Loader2 } from "lucide-react";
import Link from "next/link";

/**
 * Colab-parity "Approver 1" row on the WIR review page. Shows for
 * every checklist item while status is IN_REVIEW. Three icons on the
 * right — 💬 comment, 📷 photo, ⚠️ raise-issue — plus inline display
 * of any comment or photo the reviewer already left.
 *
 * Shraddha 2026-09-30 clarified 💬 is "just to enter comments", so
 * chat and ↩ Add Reply both open the same inline text editor and save
 * to InspectionItem.reviewerNote.
 */
export default function MobileInspectionItemReviewerControls({
  projectId,
  inspectionId,
  itemId,
  wbsNodeId,
  initialNote,
  initialPhotoUrl,
}: {
  projectId: string;
  inspectionId: string;
  itemId: string;
  wbsNodeId: string | null;
  initialNote: string | null;
  initialPhotoUrl: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(initialNote ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl ?? "");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    setError(null);
    const trimmed = note.trim();
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNote: trimmed || null }),
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
    }
  }

  async function uploadPhoto(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("scope", `wir-review-${inspectionId}`);
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
      const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerPhotoUrl: url }),
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
      const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerPhotoUrl: null }),
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

  return (
    <div className="space-y-1.5 pl-7">
      {/* Existing reviewer note render */}
      {note.trim().length > 0 && !noteEditorOpen && (
        <p className="text-[12px] text-ink bg-sandstone-50 rounded-md px-2 py-1 border border-sandstone-100 whitespace-pre-wrap">
          <span className="text-[10px] font-semibold text-ferrous-600 uppercase tracking-wider mr-1.5">
            Approver
          </span>
          {note}
        </p>
      )}

      {/* Inline note editor (opens on chat / Add Reply tap) */}
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
              disabled={isPending}
              className="text-xs font-semibold rounded-md bg-ferrous-500 text-white px-3 py-1 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Existing reviewer photo render */}
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

      {/* The Approver 1 row — icons align right, chat + camera + ⚠️
          per Colab screenshots 17-18. */}
      <div className="flex items-center justify-between text-[11px] text-stone-500">
        <span className="font-semibold text-ink">Approver 1</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNoteEditorOpen((v) => !v)}
            aria-label={note.trim().length > 0 ? "Edit approver comment" : "Add approver comment"}
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
          <Link
            href={`/mobile/${projectId}/issue/new?inspectionId=${inspectionId}${wbsNodeId ? `&wbsNodeId=${wbsNodeId}` : ""}`}
            aria-label="Flag this checkpoint as an issue"
            className="text-amber-600 hover:text-amber-700"
          >
            <AlertTriangle className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Colab-parity "↩ Add Reply" outlined pill — Girish screen 17.
          Shows only when there's no comment yet, offering the same
          action as tapping 💬. */}
      {note.trim().length === 0 && !noteEditorOpen && (
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
