"use client";

import { Download } from "lucide-react";

export type DlrCsvRow = {
  date: string;
  contractor: string;
  location: string;
  activity: string;
  totalLabour: number;
  skilled: number;
  unskilled: number;
  mason: number;
  helper: number;
  supervisor: number;
  notes: string;
};

function escapeCsv(s: string | number | null | undefined): string {
  const v = String(s ?? "").replace(/"/g, '""');
  if (/[",\n]/.test(v)) return `"${v}"`;
  return v;
}

export default function DlrCsvButton({ rows, filename }: { rows: DlrCsvRow[]; filename: string }) {
  function download() {
    const header = [
      "Date",
      "Contractor",
      "Location",
      "Activity",
      "Total Labour",
      "Skilled",
      "Unskilled",
      "Mason",
      "Helper",
      "Supervisor",
      "Notes",
    ];
    const lines = rows.map((r) =>
      [
        r.date,
        r.contractor,
        r.location,
        r.activity,
        r.totalLabour,
        r.skilled,
        r.unskilled,
        r.mason,
        r.helper,
        r.supervisor,
        r.notes,
      ]
        .map(escapeCsv)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex items-center gap-1.5 text-xs rounded-md border border-stone-300 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50 hover:border-stone-400 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      Download CSV
    </button>
  );
}
