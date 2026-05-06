"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Period = "daily" | "weekly" | "monthly";

const OPTIONS: { key: Period; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export default function LabourPeriodSwitcher({ active }: { active: Period }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const buildHref = (next: Period) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", next);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="inline-flex border border-stone-200 rounded-full bg-white p-1 gap-1 text-xs">
      {OPTIONS.map((o) => {
        const isActive = o.key === active;
        return (
          <Link
            key={o.key}
            href={buildHref(o.key)}
            className={
              "px-3 py-1 rounded-full font-medium transition-colors " +
              (isActive
                ? "bg-stone-900 text-white"
                : "text-stone-700 hover:bg-ivory")
            }
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
