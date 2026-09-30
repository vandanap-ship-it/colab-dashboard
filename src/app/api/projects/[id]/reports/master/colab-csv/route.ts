import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { istDayString } from "@/lib/istDay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Amanvana's ColabActivity table is ~7-10k rows + a similar-ish
// ProgressEntry count. Well within a few seconds. Room to grow.
export const maxDuration = 60;

/**
 * GET /api/projects/[id]/reports/master/colab-csv
 *
 * Serves the "Master Report — raw activity CSV" in Colab's exact
 * 37-column shape. Two sources feed the export:
 *
 *   1. Every ColabActivity for the project — one row per Colab-tracked
 *      activity, `rawColabRow` expanded across the fixed header order.
 *   2. Every ProgressEntry NOT imported from Colab (site engineer's
 *      Siddhi-native logs) — one synthetic row per entry, with the
 *      Colab-hierarchy columns blank and the structured fields
 *      populated from ProgressEntry + WBSNode + Villa.
 *
 * Image_Link URLs are healed:
 *   - Colab's export sometimes ships "None/uploads/…" URLs where the
 *     CDN base wasn't substituted; we rewrite them to the working CDN.
 *   - For Siddhi-native rows we pull the URL directly from
 *     ProgressPhoto.
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

// Same CDN base + rewrite policy as the Colab importer's photo path.
// See src/lib/colabSync.ts around the "Colab's CSV export has a bug"
// comment — the two must stay in sync.
const COLAB_UPLOAD_BASE = "https://node.colabtools.com/";
function healImageLink(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s || !s.includes("/uploads/")) return "";
  if (s.startsWith("None/")) return COLAB_UPLOAD_BASE + s.slice("None/".length);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return COLAB_UPLOAD_BASE + s.replace(/^\/+/, "");
}

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

  // Pull ColabActivity, all villas (for label mapping), and Siddhi-
  // native ProgressEntry rows in parallel. ProgressEntry rows already
  // imported from Colab carry an idempotencyKey starting with "colab:";
  // filter those out so we don't double-count when we merge sources.
  const [colabRows, villas, sidddhiProgress] = await Promise.all([
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
    prisma.progressEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [{ idempotencyKey: null }, { NOT: { idempotencyKey: { startsWith: "colab:" } } }],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        date: true,
        achievedQuantity: true,
        cumulativeQuantity: true,
        notes: true,
        reasonNote: true,
        wbsNode: {
          select: {
            taskCode: true,
            name: true,
            villaId: true,
            baselineStart: true,
            baselineFinish: true,
            actualStart: true,
            actualFinish: true,
            percentComplete: true,
            weightPct: true,
            totalQuantity: true,
            unit: true,
            contractor: { select: { name: true } },
          },
        },
        photos: { select: { url: true }, take: 1 },
      },
    }),
  ]);
  const villaLabelById = new Map(
    villas.map((v) => [v.id, v.label ?? `Villa ${v.number}`]),
  );

  const lines: string[] = [];
  lines.push(COLAB_HEADERS.map(csvCell).join(","));

  // ── Pass 1: Colab-sourced rows ─────────────────────────────────────
  for (const r of colabRows) {
    const raw = (r.rawColabRow ?? {}) as Record<string, string | undefined | null>;
    const villaLabel = r.villaId ? villaLabelById.get(r.villaId) ?? "" : "";
    const healedImage = healImageLink(raw["Image_Link"]);

    const cells: (string | number | null | undefined)[] = COLAB_HEADERS.map((h) => {
      if (h === "Image_Link") return healedImage;
      const rawVal = raw[h];
      if (rawVal != null && rawVal !== "") return rawVal;
      switch (h) {
        case "Project_Name":       return project.name.toUpperCase();
        case "Location_Name":      return villaLabel;
        case "Progress_Date":      return ddmmyy(r.progressDate);
        case "Actual_Start":       return ddmmyy(r.actualStart);
        case "Actual_End_Date":    return ddmmyy(r.actualEnd);
        case "Planned_Start_Date": return ddmmyy(r.plannedStart);
        case "Planned_End_Date":   return ddmmyy(r.plannedEnd);
        case "Physical_Progress":  return r.physicalProgress ?? "";
        case "Total__Progress_%":  return r.totalPct ?? "";
        case "Reason_for_Delay":   return r.reasonNote ?? "";
        case "Activity_ID":        return r.activityId;
        default:                   return "";
      }
    });
    lines.push(cells.map(csvCell).join(","));
  }

  // ── Pass 2: Siddhi-native ProgressEntry rows ──────────────────────
  // No rawColabRow to expand from — synthesise a row using the
  // ProgressEntry + linked WBSNode + Villa + ProgressPhoto. Colab-
  // hierarchy columns (Sub_Location, Activity_Head, UOM, Rate,
  // Milestone_type) stay blank; those fields are Colab-only concepts.
  for (const pe of sidddhiProgress) {
    const wbs = pe.wbsNode;
    if (!wbs) continue;
    const villaLabel = wbs.villaId ? villaLabelById.get(wbs.villaId) ?? "" : "";
    const contractorName = wbs.contractor?.name ?? "";
    const photoUrl = pe.photos?.[0]?.url ?? "";

    const cells: (string | number | null | undefined)[] = COLAB_HEADERS.map((h) => {
      switch (h) {
        case "Project_Name":            return project.name.toUpperCase();
        case "Contractor_Name":         return contractorName;
        case "Location_Name":           return villaLabel;
        case "Activity_Name":           return wbs.name;
        case "Progress_Date":           return ddmmyy(pe.date);
        case "Actual_Start":            return ddmmyy(wbs.actualStart);
        case "Actual_End_Date":         return ddmmyy(wbs.actualFinish);
        case "Planned_Start_Date":      return ddmmyy(wbs.baselineStart);
        case "Planned_End_Date":        return ddmmyy(wbs.baselineFinish);
        case "Total_Qty":               return wbs.totalQuantity ?? "";
        case "Achieved_Qty":            return pe.achievedQuantity ?? "";
        case "Cumulative__achieved_Qty":return pe.cumulativeQuantity ?? "";
        case "Total__Progress_%":       return wbs.percentComplete ?? "";
        case "Physical_Progress":       return wbs.weightPct ?? "";
        case "UOM":                     return wbs.unit ?? "";
        case "Remark":                  return pe.notes ?? "";
        case "Reason_for_Delay":        return pe.reasonNote ?? "";
        case "Image_Link":              return photoUrl;
        case "Activity_ID":             return wbs.taskCode;
        default:                        return "";
      }
    });
    lines.push(cells.map(csvCell).join(","));
  }

  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-master-report-raw-${istDayString()}.csv`;
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
