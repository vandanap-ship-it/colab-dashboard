"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import SwitchProjectModal from "./SwitchProjectModal";

export default function SwitchProjectButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Switch project"
        title="Switch project"
        className={
          compact
            ? "inline-flex items-center gap-1.5 shrink-0 text-xs rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300 transition-colors"
            : "inline-flex items-center gap-1.5 shrink-0 text-sm rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300 transition-colors"
        }
      >
        <ArrowLeftRight className={compact ? "w-3.5 h-3.5 text-stone-400" : "w-4 h-4 text-stone-400"} />
        {/* Icon-only under sm — on phones the top bar has to fit Menu +
            Switch Project + My Actions + admin icons + avatar; the wrapping
            "Switch\nProject" text collided visually with the amber My
            Actions badge next to it. */}
        <span className="hidden sm:inline">Switch Project</span>
      </button>
      <SwitchProjectModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
