import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Amanvana's ColabActivity table is ~7-10k rows; well within a few
// seconds. Room to grow for larger projects.
export const maxDuration = 60;

/**
 * GET /api/projects/[id]/reports/master/colab-csv
 *
 * Serves the "Master Report — raw activity CSV" in Colab's exact
 * 37-column shape. Each row is one ColabActivity, with its full
 * rawColabRow JSON expanded back into columns in the exact header
 * order Colab exports (see COLAB_HEADERS below).
 *
 * A row imported before the rawColabRow column existed (or one from
 * a manual MPP-only villa that never went through Colab) still gets
 * a line — the columns Siddhi does store come out populated, the
 * Colab-hierarchy columns come out empty. Better a partial row than
 * a missing activity.
 */

const COLAB_HEADERS = [
  "Project_Name",
  "Contractor_Name",
  "Location_Name",
  "Sub_Location",
  "Sub_Sub_location",
  "Activity_Type",
  "Activity_Head",
  "Activity_Name",
  "Progress_Date",
  "System_Added_Progress_Date",
  "Actual_Start",
  "Planned_Start_Date",
  "Projected_Start_Date",
  "Planned_End_Date",
  "Projected_End_Date",
  "Actual_End_Date",
  "Total_Qty",
  "Planned_Value_Quantity",
  "Achieved_Qty",
  "Cumulative__achieved_Qty",
  "Productivity",
  "Planned_Progress_%",
  "Today_Achieved_%",
  "Total__Progress_%",
  "Physical_Progress",
  "UOM",
  "Rate",
  "Amount",
  "Planned_Value",
  "Earned_Value",
  "Earned_Value_Cumulative",
  "Remark",
  "Reason_for_Delay",
  "Image_Link",
  "Milestone",
  "Milestone_type",
  "Activity_ID",
] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function ddmmyy(d: Date | null | undefined): string {
  if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Pull every ColabActivity for the project + a villa-id → label map
  // (ColabActivity has villaId but no Prisma relation on it, so we
  // resolve labels via a separate lightweight query). Rows imported
  // before rawColabRow existed still get a line with the structured
  // fields populated.
  const [rows, villas] = await Promise.all([
    prisma.colabActivity.findMany({
      where: { projectId },
      orderBy: [{ villaId: "asc" }, { progressDate: "asc" }, { activityId: "asc" }],
      select: {
        activityId: true,
        villaId: true,
        progressDate: true,
        actualStart: true,
        actualEnd: true,
        plannedStart: true,
        plannedEnd: true,
        physicalProgress: true,
        totalPct: true,
        reasonNote: true,
        rawColabRow: true,
      },
    }),
    prisma.villa.findMany({
      where: { projectId },
      select: { id: true, number: true, label: true },
    }),
  ]);
  const villaLabelById = new Map(
    villas.map((v) => [v.id, v.label ?? `Villa ${v.number}`]),
  );

  const lines: string[] = [];
  lines.push(COLAB_HEADERS.map(csvCell).join(","));

  for (const r of rows) {
    // rawColabRow can be null (pre-migration import) or a JSON object
    // (post-migration import). Treat it as a lookup with graceful
    // fallbacks to the structured fields.
    const raw = (r.rawColabRow ?? {}) as Record<string, string | undefined | null>;
    const villaLabel = r.villaId ? villaLabelById.get(r.villaId) ?? "" : "";

    const cells: (string | number | null | undefined)[] = COLAB_HEADERS.map((h) => {
      const rawVal = raw[h];
      if (rawVal != null && rawVal !== "") return rawVal;
      switch (h) {
        case "Project_Name":                return project.name.toUpperCase();
        case "Location_Name":               return villaLabel;
        case "Progress_Date":               return ddmmyy(r.progressDate);
        case "Actual_Start":                return ddmmyy(r.actualStart);
        case "Actual_End_Date":             return ddmmyy(r.actualEnd);
        case "Planned_Start_Date":          return ddmmyy(r.plannedStart);
        case "Planned_End_Date":            return ddmmyy(r.plannedEnd);
        case "Physical_Progress":           return r.physicalProgress ?? "";
        case "Total__Progress_%":           return r.totalPct ?? "";
        case "Reason_for_Delay":            return r.reasonNote ?? "";
        case "Activity_ID":                 return r.activityId;
        default:                            return "";
      }
    });
    lines.push(cells.map(csvCell).join(","));
  }

  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-master-report-raw-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
