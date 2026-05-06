"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import ProjectHighlightsModal from "./ProjectHighlightsModal";

export default function HighlightsButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50 hover:text-stone-900 hover:border-stone-300 transition-colors"
      >
        <Info className="w-4 h-4 text-stone-400" />
        Project Highlights
      </button>
      {open && <ProjectHighlightsModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}
