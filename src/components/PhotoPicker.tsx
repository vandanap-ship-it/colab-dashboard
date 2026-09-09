"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, X } from "lucide-react";

/**
 * Resize + re-encode an image on the client before it hits the network.
 * Site phones take 3-5 MB JPEGs; a 1600-px, quality-0.8 JPEG is around
 * 200-400 KB with no visible loss for construction inspection photos.
 * That's an ~85-90% bandwidth + storage saving for the Vercel Blob store.
 *
 * HEIC / HEIF from iPhone: browsers can't decode these in a canvas, so
 * they fall through and upload as-is (Vercel Blob accepts them; the
 * server converts on read).
 *
 * Any failure falls back to the original file — never lose the photo.
 */
async function compressImage(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name);
  if (isHeic || !file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    if (!blob) return file;
    // Only accept the compressed version if it actually reduced size —
    // small phone shots taken in low light can compress LARGER at q=0.8
    // than the original OS-level compression.
    if (blob.size >= file.size * 0.95) return file;
    const compressed = new File([blob], file.name.replace(/\.(png|webp|gif|heic|heif|tiff)$/i, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    return compressed;
  } catch {
    return file;
  }
}

/**
 * Photo picker with inline thumbnail previews + remove-one.
 *
 * Replaces the four ad-hoc `<input type="file" multiple>` patterns in the
 * mobile forms (progress / inspection / daily report / expense). Pre this
 * component, engineers picked 4 photos in one OS dialog and had no way to
 * drop one — if the 4th picture was blurry they had to re-pick all four.
 *
 * Behaviour:
 *   - Each picked file gets a square thumbnail with an X to remove it.
 *   - "Add photo" tile is shown as long as we're below the cap; tapping it
 *     opens the camera by default (capture="environment").
 *   - Picks merge with the existing set instead of replacing it, so the
 *     engineer can take photos one at a time.
 *   - Object URLs are revoked when the file list changes / the picker
 *     unmounts, so we don't leak memory on the device.
 */
export default function PhotoPicker({
  photos,
  setPhotos,
  max = 4,
  label = "Photos",
}: {
  photos: File[];
  setPhotos: (next: File[]) => void;
  max?: number;
  label?: string;
}) {
  const previewUrls = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);

  // Revoke URLs when the file list changes or the component unmounts.
  // useMemo + this effect together cover both cases.
  useEffect(() => {
    return () => {
      previewUrls.forEach(URL.revokeObjectURL);
    };
  }, [previewUrls]);

  const [compressing, setCompressing] = useState(false);

  async function add(incoming: FileList | null) {
    if (!incoming) return;
    setCompressing(true);
    try {
      const compressed = await Promise.all(Array.from(incoming).map(compressImage));
      const merged = [...photos, ...compressed].slice(0, max);
      setPhotos(merged);
    } finally {
      setCompressing(false);
    }
  }

  function removeAt(idx: number) {
    setPhotos(photos.filter((_, i) => i !== idx));
  }

  const showAddTile = photos.length < max;

  return (
    <div className="block">
      <span className="text-sm font-medium text-stone-700">
        {label} <span className="text-stone-400 font-normal">(up to {max})</span>
      </span>
      <div className="grid grid-cols-3 gap-2 mt-2">
        {previewUrls.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="relative aspect-square rounded-lg border border-stone-200 overflow-hidden bg-stone-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- File-blob URL, not a remote asset; next/image would just add cost */}
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeAt(i)}
              // The corner X is small on purpose (~36px) so it doesn't dominate
              // the thumbnail, but uses inset padding to give the touch box a
              // wider hit area than the visible icon.
              className="absolute top-1 right-1 bg-stone-900/85 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-stone-900 focus:outline-none focus:ring-2 focus:ring-white/80"
              aria-label={`Remove photo ${i + 1}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        {showAddTile && (
          <label className="aspect-square rounded-lg border-2 border-dashed border-stone-300 flex flex-col items-center justify-center text-stone-400 hover:border-stone-500 hover:text-stone-700 active:bg-stone-50 cursor-pointer transition-colors min-h-11">
            <Camera className="w-6 h-6" />
            <span className="text-[11px] mt-1.5 font-medium">
              {compressing
                ? "Compressing…"
                : photos.length === 0
                  ? "Add photo"
                  : `+${max - photos.length} more`}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => {
                add(e.target.files);
                // Reset so the same file can be re-picked next time after a remove.
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
