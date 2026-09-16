"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Image as ImageIcon, X } from "lucide-react";

export interface PhotoMeta {
  /** Where the photo came from — "progress", "hindrance", "snag", etc. */
  kind?: string;
  /** Project slug for the filename prefix. */
  project?: string;
  /** Block code (e.g. "3A"). */
  block?: string;
  /** Villa number or label (e.g. "14" or "10-11"). */
  villa?: string;
  /** Activity or section name at time of upload. */
  activity?: string;
  /** ISO date the row this photo belongs to was logged. */
  date?: string;
  /** Cumulative %-complete for that activity at the time of upload. */
  percent?: number;
}

export type Photo = {
  id: string;
  url: string;
  /** Optional metadata used to compose a descriptive download filename.
   *  Callers who care about human-readable downloads (Master Report,
   *  DPR, progress entries) pass full meta; callers who don't get a
   *  generic "siddhi-photo-<id>.jpg" fallback. */
  meta?: PhotoMeta;
};

// ---------------------------------------------------------------------------
// Filename composition — turns whatever meta the caller supplied into a
// safe cross-platform filename. Missing fields drop out silently.
// ---------------------------------------------------------------------------

function slug(v: string | number | undefined): string {
  if (v == null) return "";
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extFromUrl(url: string): string {
  const q = url.split("?")[0];
  const dot = q.lastIndexOf(".");
  if (dot === -1 || dot < q.length - 6) return ".jpg";
  const ext = q.slice(dot).toLowerCase();
  return /^\.(jpg|jpeg|png|webp|heic|heif|gif|pdf)$/.test(ext) ? ext : ".jpg";
}

function composeFilename(photo: Photo, indexInSet: number): string {
  const parts: string[] = [];
  const meta = photo.meta ?? {};
  parts.push("siddhi");
  if (meta.kind) parts.push(slug(meta.kind));
  if (meta.project) parts.push(slug(meta.project));
  if (meta.block) parts.push("block-" + slug(meta.block));
  if (meta.villa) parts.push("villa-" + slug(meta.villa));
  if (meta.activity) parts.push(slug(meta.activity).slice(0, 40));
  if (meta.date) parts.push(String(meta.date).slice(0, 10));
  if (meta.percent != null) parts.push(`${Math.round(meta.percent)}pct`);
  // Photo index within its set — so multi-photo entries don't collide when
  // saved into the same Downloads folder.
  parts.push(String(indexInSet + 1).padStart(2, "0"));
  // Fallback: at least include the photo id when nothing else is set.
  if (parts.length === 2) parts.push(photo.id.slice(-8));
  return parts.filter(Boolean).join("-") + extFromUrl(photo.url);
}

/**
 * Cross-origin download helper. Vercel Blob URLs are on a different origin
 * than Siddhi, so the browser ignores the `<a download>` attribute for
 * direct links. Fetching the blob and creating an object URL sidesteps
 * that — the download button always saves with our composed filename.
 */
async function downloadPhoto(photo: Photo, indexInSet: number): Promise<void> {
  const filename = composeFilename(photo, indexInSet);
  try {
    const res = await fetch(photo.url, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay revoke so the browser has time to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e) {
    console.warn("[PhotoStrip] download failed, falling back to open:", e);
    // Fallback: open in new tab, user can save-as manually.
    window.open(photo.url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Thumbnail strip that opens a fullscreen lightbox on click. Drop into any
 * server or client component that has a list of photo URLs.
 *
 * <PhotoStrip photos={entry.photos} />
 *
 * Sizes: "xs" (24px), "sm" (32px, default), "md" (48px), "lg" (72px).
 */
export default function PhotoStrip({
  photos,
  size = "sm",
  maxInline = 3,
  emptyLabel = "—",
  align = "left",
}: {
  photos: Photo[];
  size?: "xs" | "sm" | "md" | "lg";
  maxInline?: number;
  emptyLabel?: React.ReactNode;
  align?: "left" | "center";
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (photos.length === 0) {
    return (
      <span
        className={`text-stone-300 text-[11px] inline-flex items-center gap-1 ${
          align === "center" ? "justify-center" : ""
        }`}
      >
        <ImageIcon className="w-3 h-3" />
        {emptyLabel}
      </span>
    );
  }

  const px = size === "xs" ? "w-6 h-6" : size === "sm" ? "w-8 h-8" : size === "md" ? "w-12 h-12" : "w-[72px] h-[72px]";

  return (
    <>
      <div className={`flex items-center gap-1 flex-wrap ${align === "center" ? "justify-center" : ""}`}>
        {photos.slice(0, maxInline).map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            className={`block ${px} rounded-md overflow-hidden border border-stone-200 hover:border-stone-400 hover:shadow-soft transition-all`}
            title={`Photo ${i + 1} of ${photos.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
        {photos.length > maxInline && (
          <button
            type="button"
            onClick={() => setOpenIndex(0)}
            className="text-[10px] text-stone-500 hover:text-stone-900 ml-1"
          >
            +{photos.length - maxInline}
          </button>
        )}
      </div>
      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

export function Lightbox({
  photos,
  index,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);
  const [downloading, setDownloading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + photos.length) % photos.length);
      if (e.key === "ArrowRight") setI((x) => (x + 1) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  const current = photos[i];
  const meta = current?.meta;

  const overlay = (
    <div
      className="fixed inset-0 z-[10000] bg-stone-900/95 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Top strip — caption on the left, download + close on the right. Its
          own solid-tinted band so the caption never overlaps the image or
          the navbar under it, and reads cleanly on any photo colour. */}
      <div
        className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/10 bg-stone-950/70 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 text-white space-y-1.5">
          {photos.length > 1 && (
            <div className="text-white/60 text-xs font-medium tabular-nums">
              {i + 1} / {photos.length}
            </div>
          )}
          {meta ? (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-white/80">
              {meta.block && <span>Block <b className="text-white">{meta.block}</b></span>}
              {meta.villa && <span>Villa <b className="text-white">{meta.villa}</b></span>}
              {meta.activity && <span className="text-white/95 truncate max-w-[46ch]">{meta.activity}</span>}
              {meta.date && (
                <span className="text-white/70">
                  {new Date(meta.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
              {meta.percent != null && (
                <span><b className="text-white">{Math.round(meta.percent)}%</b> complete</span>
              )}
            </div>
          ) : (
            <div className="text-sm text-white/70">Photo</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              if (!current || downloading) return;
              setDownloading(true);
              try { await downloadPhoto(current, i); } finally { setDownloading(false); }
            }}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/12 hover:bg-white/20 text-white text-sm font-medium px-3.5 py-2 transition-colors disabled:opacity-60"
            aria-label="Download photo"
            title="Download photo"
          >
            <Download className="w-4 h-4" />
            {downloading ? "Downloading…" : "Download"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Image strip — fills the remaining viewport, centred. Photo stays clear
          of both the top caption bar and (when present) the side arrows. */}
      <div
        className="flex-1 flex items-center justify-center p-4 min-h-0"
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current?.url}
          alt=""
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x - 1 + photos.length) % photos.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl px-3 py-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x + 1) % photos.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl px-3 py-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
            aria-label="Next"
          >
            ›
          </button>
        </>
      )}
    </div>
  );

  // Portal so we escape any parent stacking context (e.g. the sticky navbar
  // with z-30 that would otherwise render on top of us and bleed through the
  // caption strip). Falls back to null on the SSR pass; the first client
  // render mounts and paints.
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
