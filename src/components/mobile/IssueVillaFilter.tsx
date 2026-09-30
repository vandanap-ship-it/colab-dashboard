"use client";

import { useRouter } from "next/navigation";

type VillaOption = { id: string; number: number; label: string | null };

/**
 * Tiny client wrapper around a native <select> that navigates the
 * Issue list to the same tab with the new villa param on change.
 * Stays a bottom-of-page pattern (the outer list is a Server
 * Component) — the picker itself is the only interactive bit.
 */
export default function IssueVillaFilter({
  projectId,
  tab,
  villas,
  picked,
}: {
  projectId: string;
  tab: string;
  villas: VillaOption[];
  picked: string;
}) {
  const router = useRouter();

  return (
    <div className="sticky top-[calc(3rem+2.5rem)] z-[9] bg-ivory/95 backdrop-blur-md border-b border-stone-200 px-4 py-2">
      <label className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="font-semibold uppercase tracking-wider">Villa</span>
        <select
          value={picked}
          onChange={(e) => {
            const v = e.target.value;
            const qs = v ? `?tab=${tab}&villa=${encodeURIComponent(v)}` : `?tab=${tab}`;
            router.push(`/mobile/${projectId}/issue${qs}`);
          }}
          className="flex-1 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[13px]"
        >
          <option value="">All villas</option>
          {villas.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label || `Villa ${String(v.number).padStart(2, "0")}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
