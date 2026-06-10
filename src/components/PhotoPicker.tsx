"use client";

import { useEffect, useMemo } from "react";
import { Camera, X } from "lucide-react";

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

  function add(incoming: FileList | null) {
    if (!incoming) return;
    const merged = [...photos, ...Array.from(incoming)].slice(0, max);
    setPhotos(merged);
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
              {photos.length === 0 ? "Add photo" : `+${max - photos.length} more`}
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
