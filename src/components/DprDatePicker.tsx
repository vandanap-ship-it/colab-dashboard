"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function DprDatePicker({
  projectId,
  selected,
}: {
  projectId: string;
  selected: string;
}) {
  const router = useRouter();
  const search = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("date", next);
    router.push(`/projects/${projectId}/dpr?${params.toString()}`);
  };

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-stone-500">Date</span>
      <input
        type="date"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-stone-300 px-3 py-1 text-sm focus:outline-none focus:border-stone-900"
      />
    </label>
  );
}
