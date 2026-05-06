"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function DateRangePicker({
  basePath,
  startDate,
  endDate,
}: {
  basePath: string;
  startDate: string;
  endDate: string;
}) {
  const router = useRouter();
  const search = useSearchParams();

  const navigate = (next: { from?: string; to?: string }) => {
    const params = new URLSearchParams(search.toString());
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-stone-500 text-xs">From</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => navigate({ from: e.target.value, to: endDate })}
          className="rounded-lg border border-stone-300 px-2 py-1 text-xs focus:outline-none focus:border-stone-900"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-stone-500 text-xs">To</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => navigate({ from: startDate, to: e.target.value })}
          className="rounded-lg border border-stone-300 px-2 py-1 text-xs focus:outline-none focus:border-stone-900"
        />
      </label>
    </div>
  );
}
