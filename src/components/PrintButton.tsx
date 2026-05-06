"use client";

import { Printer } from "lucide-react";

export default function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 transition-colors print:hidden"
    >
      <Printer className="w-4 h-4" />
      {label}
    </button>
  );
}
