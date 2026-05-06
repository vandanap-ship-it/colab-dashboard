"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

export type Chip = {
  key: string;
  label: string;
  count: number;
  /** When true, the chip is shown but selecting it explains why no data is here yet. */
  stubbed?: boolean;
};

export type CardItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  href?: string;
};

type ChipPanel = {
  items: CardItem[];
  emptyText?: string;
  stubText?: string;
};

export default function MyActionsCard({
  title,
  totalCount,
  chips,
  panels,
  viewAllHref,
  icon,
}: {
  title: string;
  totalCount: number;
  chips: Chip[];
  panels: Record<string, ChipPanel>;
  viewAllHref?: string;
  icon?: ReactNode;
}) {
  const initialKey = chips.find((c) => !c.stubbed)?.key ?? chips[0]?.key ?? "";
  const [active, setActive] = useState(initialKey);
  const activeChip = chips.find((c) => c.key === active);
  const panel = panels[active] ?? { items: [] };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-stone-900">
            {title}
            <span className="ml-1 text-stone-400">({totalCount})</span>
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((c) => {
            const isActive = c.key === active;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setActive(c.key)}
                className={
                  "relative text-xs font-medium rounded-full px-3 py-1 border " +
                  (isActive
                    ? "bg-amber-400 border-amber-400 text-stone-900"
                    : "bg-white border-stone-200 text-stone-700 hover:bg-ivory")
                }
              >
                {c.label}
                <span
                  className={
                    "ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold w-4 h-4 " +
                    (c.count > 0
                      ? "bg-red-500 text-white"
                      : "bg-stone-100 text-stone-500")
                  }
                >
                  {c.count}
                </span>
              </button>
            );
          })}
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="text-xs rounded-full bg-stone-900 text-white px-3 py-1 hover:opacity-90"
            >
              View All
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 flex-1 min-h-[100px]">
        {activeChip?.stubbed ? (
          <p className="text-xs text-stone-400 text-center py-6">
            {panel.stubText ?? "Coming in v1.1."}
          </p>
        ) : panel.items.length === 0 ? (
          <p className="text-xs text-stone-400 text-center py-6">
            {panel.emptyText ?? "Nothing here."}
          </p>
        ) : (
          <ul className="space-y-2">
            {panel.items.slice(0, 5).map((it) => (
              <li
                key={it.id}
                className="text-sm text-stone-800 border-b border-stone-100 last:border-b-0 pb-2 last:pb-0"
              >
                {it.href ? (
                  <Link href={it.href} className="hover:underline">
                    {it.title}
                  </Link>
                ) : (
                  it.title
                )}
                {it.subtitle && (
                  <div className="text-xs text-stone-500 mt-0.5">{it.subtitle}</div>
                )}
              </li>
            ))}
            {panel.items.length > 5 && (
              <li className="text-xs text-stone-500 text-center pt-1">
                +{panel.items.length - 5} more
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
