"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";

export type Photo = { id: string; url: string };

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
          urls={photos.map((p) => p.url)}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

export function Lightbox({
  urls,
  index,
  onClose,
}: {
  urls: string[];
  index: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(index);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + urls.length) % urls.length);
      if (e.key === "ArrowRight") setI((x) => (x + 1) % urls.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [urls.length, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white p-2"
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>
      {urls.length > 1 && (
        <span className="absolute top-4 left-4 text-white/60 text-sm">
          {i + 1} / {urls.length}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[i]}
        alt=""
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {urls.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x - 1 + urls.length) % urls.length);
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
              setI((x) => (x + 1) % urls.length);
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
