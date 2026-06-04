"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Upload, Download, Trash2, X, RotateCw } from "lucide-react";
import {
  DRAWING_DISCIPLINES,
  DRAWING_DISCIPLINE_LABELS,
  type DrawingDiscipline,
} from "@/lib/drawings";

type Person = { id: string; name: string } | null;
type Revision = {
  id: string;
  revisionLabel: string;
  fileUrl: string;
  fileName: string;
  issuedDate: string;
  notes: string | null;
  uploadedAt: string;
  uploadedBy: Person;
};
type Drawing = {
  id: string;
  drawingNumber: string;
  title: string;
  discipline: string;
  notes: string | null;
  currentRevision: Revision | null;
  createdBy: Person;
  revisions?: Revision[]; // populated only when fetched as detail
  _count?: { revisions: number };
};

const DISCIPLINE_STYLE: Record<string, string> = {
  ARCHITECTURAL: "bg-blue-100 text-blue-700",
  STRUCTURAL: "bg-stone-200 text-stone-700",
  MEP: "bg-purple-100 text-purple-700",
  INTERIOR: "bg-rose-100 text-rose-700",
  LANDSCAPE: "bg-emerald-100 text-emerald-700",
  OTHER: "bg-amber-100 text-amber-700",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function DrawingsManager({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [drawings, setDrawings] = useState<Drawing[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<"list" | { mode: "new" } | { mode: "detail"; drawing: Drawing }>("list");
  const [search, setSearch] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState<"ALL" | string>("ALL");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`/api/drawings?projectId=${projectId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!cancelled) setDrawings(d.drawings ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const filtered = useMemo(() => {
    if (!drawings) return [];
    const q = search.trim().toLowerCase();
    return drawings.filter(
      (d) =>
        (disciplineFilter === "ALL" || d.discipline === disciplineFilter) &&
        (q === "" ||
          d.drawingNumber.toLowerCase().includes(q) ||
          d.title.toLowerCase().includes(q)),
    );
  }, [drawings, search, disciplineFilter]);

  async function openDetail(drawing: Drawing) {
    setActionError(null);
    try {
      const res = await fetch(`/api/drawings/${drawing.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setView({ mode: "detail", drawing: data.drawing });
    } catch {
      setActionError("Couldn't open drawing details. Please retry.");
    }
  }

  async function deleteDrawing(drawing: Drawing) {
    if (!confirm(`Move drawing ${drawing.drawingNumber} to trash?`)) return;
    setActionError(null);
    const res = await fetch(`/api/drawings/${drawing.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setActionError(data?.error ?? `Delete failed (${res.status})`);
    } else {
      setView("list");
      reload();
    }
  }

  if (view !== "list" && view.mode === "new") {
    return (
      <NewDrawingForm
        projectId={projectId}
        onDone={() => {
          setView("list");
          reload();
        }}
        onCancel={() => setView("list")}
      />
    );
  }
  if (view !== "list" && view.mode === "detail") {
    return (
      <DrawingDetail
        drawing={view.drawing}
        canManage={canManage}
        onClose={() => setView("list")}
        onChanged={() => {
          reload();
          // re-fetch detail too
          openDetail(view.drawing);
        }}
        onDelete={canManage ? () => deleteDrawing(view.drawing) : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Drawings</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setView({ mode: "new" })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-stone-800"
          >
            <Plus className="w-4 h-4" /> Add drawing
          </button>
        )}
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {loadError ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-sm text-stone-600">Couldn&apos;t load drawings.</p>
          <button type="button" onClick={reload} className="mt-2 text-sm font-medium text-stone-900 underline">
            Retry
          </button>
        </div>
      ) : !drawings ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : drawings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">No drawings in the register yet.</p>
          {canManage && (
            <button
              type="button"
              onClick={() => setView({ mode: "new" })}
              className="mt-2 text-sm font-medium text-amber-600"
            >
              Add the first drawing
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drawing # or title…"
              className="flex-1 min-w-[14rem] rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm placeholder:text-stone-400"
            />
            <select
              value={disciplineFilter}
              onChange={(e) => setDisciplineFilter(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="ALL">All disciplines</option>
              {DRAWING_DISCIPLINES.map((d) => (
                <option key={d} value={d}>
                  {DRAWING_DISCIPLINE_LABELS[d as DrawingDiscipline]}
                </option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-stone-500">No drawings match the current filter.</p>
          ) : (
            <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
              {filtered.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(d)}
                    className="w-full text-left px-4 py-3 hover:bg-stone-50 transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs font-semibold text-stone-700 tabular-nums">
                        {d.drawingNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-stone-900 truncate">{d.title}</div>
                        <div className="text-[11px] text-stone-500 mt-0.5">
                          {DRAWING_DISCIPLINE_LABELS[d.discipline as DrawingDiscipline] ?? d.discipline}
                          {d.currentRevision
                            ? ` · ${d.currentRevision.revisionLabel} · issued ${fmtDate(d.currentRevision.issuedDate)}`
                            : " · no revisions yet"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${DISCIPLINE_STYLE[d.discipline] ?? "bg-stone-100 text-stone-600"}`}
                      >
                        {d.discipline}
                      </span>
                      {d.currentRevision && (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <a
                            href={d.currentRevision.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" /> Open
                          </a>
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function NewDrawingForm({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [drawingNumber, setDrawingNumber] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState<DrawingDiscipline>("ARCHITECTURAL");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (drawingNumber.trim().length < 1) {
      setError("Drawing number required (e.g. A-104, S-201).");
      return;
    }
    if (title.trim().length < 2) {
      setError("Add a short title.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, drawingNumber, title, discipline, notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Save failed (${res.status})`);
        setPending(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error. Please retry.");
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
      <h2 className="text-lg font-semibold text-stone-900">Add drawing</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Drawing # </span>
          <input
            value={drawingNumber}
            onChange={(e) => setDrawingNumber(e.target.value)}
            placeholder="e.g. A-104"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Discipline</span>
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as DrawingDiscipline)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {DRAWING_DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {DRAWING_DISCIPLINE_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-stone-700">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Earth Bedroom Ground Floor"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-stone-700">Notes (optional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add drawing"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DrawingDetail({
  drawing,
  canManage,
  onClose,
  onChanged,
  onDelete,
}: {
  drawing: Drawing;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDelete?: () => void;
}) {
  const revisions = drawing.revisions ?? [];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-stone-700">{drawing.drawingNumber}</span>
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${DISCIPLINE_STYLE[drawing.discipline] ?? "bg-stone-100 text-stone-600"}`}
            >
              {drawing.discipline}
            </span>
          </div>
          <h2 className="text-lg font-semibold text-stone-900 mt-1">{drawing.title}</h2>
          {drawing.notes && <p className="text-xs text-stone-500 mt-1">{drawing.notes}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 inline-flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" /> Close
        </button>
      </div>

      {drawing.currentRevision && (
        <div className="rounded-lg bg-stone-50 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-semibold text-stone-900">
              Current: {drawing.currentRevision.revisionLabel}
            </div>
            <div className="text-xs text-stone-500">
              Issued {fmtDate(drawing.currentRevision.issuedDate)}
              {drawing.currentRevision.uploadedBy && ` · by ${drawing.currentRevision.uploadedBy.name}`}
            </div>
            {drawing.currentRevision.notes && (
              <div className="text-xs text-stone-600 mt-1">{drawing.currentRevision.notes}</div>
            )}
          </div>
          <a
            href={drawing.currentRevision.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-stone-800"
          >
            <Download className="w-3.5 h-3.5" /> Open file
          </a>
        </div>
      )}

      {canManage && <NewRevisionForm drawingId={drawing.id} onDone={onChanged} />}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2">
          Revision history ({revisions.length})
        </h3>
        {revisions.length === 0 ? (
          <p className="text-sm text-stone-500">No revisions yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
            {revisions.map((r) => (
              <li key={r.id} className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-900">
                    {r.revisionLabel}
                    {drawing.currentRevision?.id === r.id && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-stone-500">
                    Issued {fmtDate(r.issuedDate)}
                    {r.uploadedBy && ` · by ${r.uploadedBy.name}`}
                  </div>
                  {r.notes && <div className="text-xs text-stone-600 mt-1">{r.notes}</div>}
                </div>
                <a
                  href={r.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-stone-600 hover:text-stone-900 inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> {r.fileName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && onDelete && (
        <div className="pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Move to trash
          </button>
        </div>
      )}
    </div>
  );
}

function NewRevisionForm({ drawingId, onDone }: { drawingId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [revisionLabel, setRevisionLabel] = useState("");
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) {
      setError("Pick a file (PDF or image).");
      return;
    }
    if (revisionLabel.trim().length < 1) {
      setError("Revision label required (e.g. R0, R1).");
      return;
    }
    setPending(true);
    setError(null);
    try {
      // 1. Upload the file to /api/upload, get back the URL.
      const fd = new FormData();
      fd.set("scope", `drawing-${drawingId}`);
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) {
        const data = await upRes.json().catch(() => null);
        setError(data?.error ?? `Upload failed (${upRes.status})`);
        setPending(false);
        return;
      }
      const url = (await upRes.json()).urls[0] as string;

      // 2. Create the revision record + set as current.
      const revRes = await fetch(`/api/drawings/${drawingId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionLabel,
          fileUrl: url,
          fileName: file.name,
          issuedDate,
          notes,
        }),
      });
      if (!revRes.ok) {
        const data = await revRes.json().catch(() => null);
        setError(data?.error ?? `Save failed (${revRes.status})`);
        setPending(false);
        return;
      }
      // Reset and reload.
      setFile(null);
      setRevisionLabel("");
      setNotes("");
      setPending(false);
      onDone();
    } catch {
      setError("Network error. Please retry.");
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-stone-300 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5">
        <RotateCw className="w-3.5 h-3.5" /> Upload a new revision
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs text-stone-700 file:mr-3 file:rounded-md file:border-0 file:bg-stone-900 file:text-white file:px-3 file:py-1.5 file:text-xs"
        />
        <input
          value={revisionLabel}
          onChange={(e) => setRevisionLabel(e.target.value)}
          placeholder="Label (R0, R1, A …)"
          className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono"
        />
        <input
          type="date"
          value={issuedDate}
          onChange={(e) => setIssuedDate(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Revision notes (optional)"
          className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={upload}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      >
        <Upload className="w-3.5 h-3.5" />
        {pending ? "Uploading…" : "Upload revision"}
      </button>
    </div>
  );
}
