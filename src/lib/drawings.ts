/**
 * Drawing-register rules + helpers (Phase 1).
 *
 * Pure logic so the discipline normalisation, drawing-number checks, summary,
 * and CSV are unit-testable in isolation from the DB.
 */

export const DRAWING_DISCIPLINES = [
  "ARCHITECTURAL",
  "STRUCTURAL",
  "MEP",
  "INTERIOR",
  "LANDSCAPE",
  "OTHER",
] as const;
export type DrawingDiscipline = (typeof DRAWING_DISCIPLINES)[number];

export const DRAWING_DISCIPLINE_LABELS: Record<DrawingDiscipline, string> = {
  ARCHITECTURAL: "Architectural",
  STRUCTURAL: "Structural",
  MEP: "MEP",
  INTERIOR: "Interior",
  LANDSCAPE: "Landscape",
  OTHER: "Other",
};

/** Coerce a discipline value to one of the known set; falls back to OTHER. */
export function normalizeDiscipline(d: unknown): DrawingDiscipline {
  return (DRAWING_DISCIPLINES as readonly string[]).includes(d as string)
    ? (d as DrawingDiscipline)
    : "OTHER";
}

/**
 * Drawing numbers are simple identifiers like "A-104", "S-201", "MEP-12.3".
 * We trim whitespace, uppercase, and require at least one character.
 */
export function normalizeDrawingNumber(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().toUpperCase();
}

/**
 * Revision labels: free-form short string like "R0", "R1", "A", "B-1".
 * Upper-cased and trimmed; max 16 characters so headers stay clean.
 */
export function normalizeRevisionLabel(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim().toUpperCase();
  return s.length > 16 ? s.slice(0, 16) : s;
}

/** Per-discipline count, plus total + with-revision counts. */
export function summariseDrawings(
  drawings: { discipline: string; currentRevisionId: string | null }[],
): {
  byDiscipline: Record<string, number>;
  total: number;
  withRevision: number;
} {
  const byDiscipline: Record<string, number> = {};
  let withRevision = 0;
  for (const d of drawings) {
    byDiscipline[d.discipline] = (byDiscipline[d.discipline] ?? 0) + 1;
    if (d.currentRevisionId) withRevision += 1;
  }
  return { byDiscipline, total: drawings.length, withRevision };
}

export type DrawingCsvRow = {
  drawingNumber: string;
  title: string;
  discipline: string;
  currentRevisionLabel: string | null;
  issuedDate: string | null;
  uploadedBy: string | null;
};

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function drawingsToCsv(rows: DrawingCsvRow[]): string {
  const header = ["Drawing #", "Title", "Discipline", "Current Revision", "Issued Date", "Uploaded By"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.drawingNumber,
        r.title,
        r.discipline,
        r.currentRevisionLabel ?? "",
        r.issuedDate ?? "",
        r.uploadedBy ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
