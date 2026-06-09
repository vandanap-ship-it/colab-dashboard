"use client";

import { Download } from "lucide-react";
import type { MasterReportData } from "@/lib/reports";

/**
 * Download the Master Report as a multi-section CSV. The MD's request: open
 * Siddhi at 7am, scan the home page, drill into a worrying project, hit
 * "Download CSV", forward as an Excel attachment to the family / board. The
 * existing PrintButton produces a 3-page PDF that's a pain to attach.
 *
 * The CSV has four sections, separated by blank rows so Excel auto-aligns:
 *   1. Project info (name, code, period, report time)
 *   2. Overall metrics (key-value pairs)
 *   3. Zones (tabular)
 *   4. Activities (tabular — the most data-dense, useful for sorting/pivoting)
 *
 * We skip the photo highlights — CSV can't carry images.
 */

function escapeCsv(s: string | number | null | undefined): string {
  const v = String(s ?? "—").replace(/"/g, '""');
  if (/[",\n]/.test(v)) return `"${v}"`;
  return v;
}

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function MasterReportCsvButton({
  projectName,
  projectCode,
  periodLabel,
  data,
}: {
  projectName: string;
  projectCode: string | null;
  periodLabel: string;
  data: MasterReportData;
}) {
  function download() {
    const rows: string[] = [];
    const blank = () => rows.push("");

    // --- 1. Project info ---
    rows.push(["Project", escapeCsv(projectName)].join(","));
    if (projectCode) rows.push(["Code", escapeCsv(projectCode)].join(","));
    rows.push(["Report period", escapeCsv(periodLabel)].join(","));
    rows.push(["Generated", escapeCsv(new Date().toLocaleString())].join(","));
    blank();

    // --- 2. Overall ---
    rows.push("Overall");
    const o = data.overall;
    rows.push(["Planned %", escapeCsv(o.plannedPercent)].join(","));
    rows.push(["Achieved %", escapeCsv(o.achievedPercent)].join(","));
    rows.push(["Planned start", escapeCsv(fmt(o.plannedStart))].join(","));
    rows.push(["Planned end", escapeCsv(fmt(o.plannedEnd))].join(","));
    rows.push(["Actual start", escapeCsv(fmt(o.actualStart))].join(","));
    rows.push(["Projected end", escapeCsv(fmt(o.projectedEnd))].join(","));
    rows.push(["RERA end", escapeCsv(fmt(o.reraEndDate))].join(","));
    rows.push(["Planned duration (days)", escapeCsv(o.plannedDurationDays)].join(","));
    rows.push(["Projected duration (days)", escapeCsv(o.projectedDurationDays)].join(","));
    rows.push(["Total delay (days)", escapeCsv(o.totalDelayDays)].join(","));
    rows.push(["RERA delay (days)", escapeCsv(o.reraDelayDays)].join(","));
    rows.push(["Open hindrances", escapeCsv(o.hindrancesOpen)].join(","));
    blank();

    // --- 3. Zones ---
    if (data.perZone.length > 0) {
      rows.push("Zones");
      rows.push(
        [
          "Zone",
          "Planned start",
          "Planned finish",
          "Planned duration (days)",
          "Actual start",
          "Projected finish",
          "Actual duration (days)",
          "Actual %",
          "Total delay (days)",
          "Open hindrances",
        ].join(","),
      );
      for (const z of data.perZone) {
        rows.push(
          [
            z.name,
            fmt(z.plannedStart),
            fmt(z.plannedFinish),
            z.plannedDurationDays,
            fmt(z.actualStart),
            fmt(z.projectedFinish),
            z.actualDurationDays,
            z.actualPercent,
            z.totalDelayDays,
            z.hindrancesCount,
          ]
            .map(escapeCsv)
            .join(","),
        );
      }
      blank();
    }

    // --- 4. Activities ---
    if (data.totalActivities.length > 0) {
      rows.push("Activities");
      rows.push(
        [
          "Activity",
          "Location",
          "Planned %",
          "Actual %",
          "Reason for delay",
          "Planned start",
          "Planned end",
          "Projected end",
        ].join(","),
      );
      for (const a of data.totalActivities) {
        rows.push(
          [
            a.name,
            a.location,
            a.plannedPercent,
            a.actualPercent,
            a.delayReason,
            fmt(a.plannedStart),
            fmt(a.plannedEnd),
            fmt(a.projectedEnd),
          ]
            .map(escapeCsv)
            .join(","),
        );
      }
    }

    const csv = rows.join("\n");
    // BOM keeps Excel's UTF-8 detection happy when project names have
    // non-ASCII (Kannada / Marathi / Hindi villa names).
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(projectName)}-master-report-${new Date().toISOString().slice(0, 10)}.csv`;
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
