"use client";

import { useEffect, useState } from "react";
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

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Top-left counter + metadata caption. Meta appears when the caller
          supplied it — block, villa, activity, date, %-complete. */}
      <div className="absolute top-4 left-4 max-w-[70vw] text-white/70 text-xs space-y-1">
        {photos.length > 1 && <div className="text-white/60 text-sm">{i + 1} / {photos.length}</div>}
        {meta && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/60">
            {meta.block && <span>Block <b className="text-white/90">{meta.block}</b></span>}
            {meta.villa && <span>Villa <b className="text-white/90">{meta.villa}</b></span>}
            {meta.activity && <span className="truncate">{meta.activity}</span>}
            {meta.date && <span>{new Date(meta.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
            {meta.percent != null && <span><b className="text-white/90">{Math.round(meta.percent)}%</b> complete</span>}
          </div>
        )}
      </div>

      {/* Top-right: Download + Close */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            if (!current || downloading) return;
            setDownloading(true);
            try { await downloadPhoto(current, i); } finally { setDownloading(false); }
          }}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-sm font-medium px-3 py-1.5 transition-colors disabled:opacity-60"
          aria-label="Download photo"
          title="Download photo"
        >
          <Download className="w-4 h-4" />
          {downloading ? "Downloading…" : "Download"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-white/70 hover:text-white p-2"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current?.url}
        alt=""
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x - 1 + photos.length) % photos.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl px-3 py-2"
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
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-3xl px-3 py-2"
            aria-label="Next"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
