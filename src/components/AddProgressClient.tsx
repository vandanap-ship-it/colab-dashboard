"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import PhotoStrip from "./PhotoStrip";

export type ProgressEntryRow = {
  id: string;
  date: string; // ISO
  type: string;
  achievedQuantity: number;
  cumulativeQuantity: number;
  notes: string | null;
  activity: { id: string; name: string; taskCode: string; unit: string | null; totalQuantity: number | null };
  contractor: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  labour: { category: string; count: number }[];
  photos: { id: string; url: string }[];
};

export type ActivityOption = {
  id: string;
  name: string;
  taskCode: string;
  unit: string | null;
  totalQuantity: number | null;
};

export type ContractorOption = {
  id: string;
  name: string;
};

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AddProgressClient({
  projectId,
  entries: initialEntries,
  activities,
  contractors,
}: {
  projectId: string;
  entries: ProgressEntryRow[];
  activities: ActivityOption[];
  contractors: ContractorOption[];
}) {
  const [entries, setEntries] = useState<ProgressEntryRow[]>(initialEntries);
  const [search, setSearch] = useState("");
  const [contractorFilter, setContractorFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ProgressEntryRow | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (contractorFilter !== "ALL" && e.contractor?.name !== contractorFilter) return false;
      if (q) {
        const haystack = [
          e.activity.name,
          e.activity.taskCode,
          e.contractor?.name ?? "",
          e.notes ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, contractorFilter]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this progress entry? This cannot be undone.")) return;
    const res = await fetch(`/api/progress/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((es) => es.filter((e) => e.id !== id));
    } else {
      window.alert("Couldn't delete. You may not have permission.");
    }
  }

  function handleSaved(saved: ProgressEntryRow, isEdit: boolean) {
    if (isEdit) {
      setEntries((es) => es.map((e) => (e.id === saved.id ? saved : e)));
    } else {
      setEntries((es) => [saved, ...es]);
    }
    setShowForm(false);
    setEditingEntry(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity, contractor, notes…"
            className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
          />
          <select
            value={contractorFilter}
            onChange={(e) => setContractorFilter(e.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1.5 text-xs focus:outline-none focus:border-stone-900 max-w-[180px]"
          >
            <option value="ALL">All contractors</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50 hover:border-stone-300 transition-colors"
          >
            <Upload className="w-4 h-4 text-stone-400" />
            Bulk upload
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingEntry(null);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 text-sm rounded-lg bg-stone-900 text-white px-3 py-1.5 hover:bg-stone-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New entry
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead className="bg-stone-50">
              <tr className="text-[10px] uppercase tracking-wider text-stone-500">
                <th className="text-left font-medium py-2 px-3">Date</th>
                <th className="text-left font-medium py-2 px-3">Activity</th>
                <th className="text-left font-medium py-2 px-3">Contractor</th>
                <th className="text-right font-medium py-2 px-3">Achieved</th>
                <th className="text-right font-medium py-2 px-3">Cumulative</th>
                <th className="text-right font-medium py-2 px-3">Labour</th>
                <th className="text-left font-medium py-2 px-3">Photos</th>
                <th className="text-left font-medium py-2 px-3">Logged by</th>
                <th className="font-medium py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-stone-500 text-sm">
                    No entries match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => {
                  const labourTotal = e.labour.reduce((s, l) => s + l.count, 0);
                  return (
                    <tr key={e.id} className="border-t border-stone-100">
                      <td className="py-2 px-3 text-stone-700 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <CalendarDays className="w-3 h-3 text-stone-400" />
                          {fmt(e.date)}
                        </div>
                      </td>
                      <td className="py-2 px-3 max-w-[260px]">
                        <div className="font-medium text-stone-900 leading-snug">
                          {e.activity.name}
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {e.activity.taskCode}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-stone-700">
                        {e.contractor?.name ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-stone-900 font-medium">
                        {e.achievedQuantity}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-stone-700">
                        {e.cumulativeQuantity}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-stone-700">
                        {labourTotal}
                      </td>
                      <td className="py-2 px-3">
                        <PhotoStrip photos={e.photos} />
                      </td>
                      <td className="py-2 px-3 text-stone-500 text-[11px]">
                        {e.createdBy.name}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEntry(e);
                              setShowForm(true);
                            }}
                            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            className="p-1.5 rounded-md text-stone-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-stone-400 text-right">
        Showing {filtered.length} of {entries.length} entries.
      </p>

      {showForm && (
        <ProgressEntryDialog
          projectId={projectId}
          entry={editingEntry}
          activities={activities}
          contractors={contractors}
          onClose={() => {
            setShowForm(false);
            setEditingEntry(null);
          }}
          onSaved={handleSaved}
        />
      )}

      {csvOpen && (
        <BulkCsvDialog
          projectId={projectId}
          activities={activities}
          contractors={contractors}
          onClose={() => setCsvOpen(false)}
          onComplete={() => {
            setCsvOpen(false);
            // Refetch entries after bulk import
            window.location.reload();
          }}
        />
      )}

    </div>
  );
}

// ----- ProgressEntryDialog: New / Edit form -----

function ProgressEntryDialog({
  entry,
  activities,
  contractors,
  onClose,
  onSaved,
}: {
  projectId: string;
  entry: ProgressEntryRow | null;
  activities: ActivityOption[];
  contractors: ContractorOption[];
  onClose: () => void;
  onSaved: (saved: ProgressEntryRow, isEdit: boolean) => void;
}) {
  const isEdit = entry !== null;
  const [date, setDate] = useState(
    entry ? entry.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [activityId, setActivityId] = useState(entry?.activity.id ?? activities[0]?.id ?? "");
  const [activitySearch, setActivitySearch] = useState("");
  const [contractorId, setContractorId] = useState(entry?.contractor?.id ?? "");
  const [achieved, setAchieved] = useState(entry ? String(entry.achievedQuantity) : "0");
  const [cumulative, setCumulative] = useState(entry ? String(entry.cumulativeQuantity) : "0");
  const [type, setType] = useState(entry?.type ?? "LABOUR_SUPPLY");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [labour, setLabour] = useState<{ category: string; count: number }[]>(
    entry?.labour ?? [{ category: "Skilled", count: 0 }],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activity = useMemo(
    () => activities.find((a) => a.id === activityId) ?? null,
    [activities, activityId],
  );

  const filteredActivities = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activities.slice(0, 50);
    return activities
      .filter((a) =>
        a.name.toLowerCase().includes(q) || a.taskCode.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [activities, activitySearch]);

  function updateLabour(i: number, patch: Partial<{ category: string; count: number }>) {
    setLabour((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addLabourRow() {
    setLabour((rows) => [...rows, { category: "Helper", count: 0 }]);
  }

  function removeLabourRow(i: number) {
    setLabour((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activityId) {
      setError("Pick an activity.");
      return;
    }
    setPending(true);
    setError(null);

    const payload = {
      wbsNodeId: activityId,
      date,
      type,
      achievedQuantity: Number(achieved),
      cumulativeQuantity: Number(cumulative),
      contractorId: contractorId || null,
      notes,
      labour: labour.filter((l) => l.count > 0 && l.category.trim().length > 0),
    };

    const res = await fetch(isEdit ? `/api/progress/${entry.id}` : "/api/progress", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to save.");
      return;
    }

    // Reconstruct the row shape we expect — refetch path is simpler but requires API changes.
    // For now: optimistic stitch with what we know.
    const data = await res.json();
    const saved = data.entry;
    const built: ProgressEntryRow = {
      id: saved.id,
      date: new Date(saved.date).toISOString(),
      type: saved.type,
      achievedQuantity: saved.achievedQuantity,
      cumulativeQuantity: saved.cumulativeQuantity,
      notes: saved.notes,
      activity: activity!,
      contractor: contractors.find((c) => c.id === contractorId) ?? null,
      createdBy: entry?.createdBy ?? { id: "", name: "You" },
      labour: payload.labour,
      photos: entry?.photos ?? [],
    };
    onSaved(built, isEdit);
  }

  return (
    <Dialog onClose={onClose} title={isEdit ? "Edit progress entry" : "New progress entry"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-stone-900"
            >
              <option value="LABOUR_SUPPLY">Labour Supply</option>
              <option value="PRW">PRW</option>
              <option value="MISC">Misc</option>
            </select>
          </Field>
        </div>

        <Field label="Activity">
          <input
            type="text"
            placeholder="Search activity by name or code…"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
          />
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-stone-200 divide-y divide-stone-100">
            {filteredActivities.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => setActivityId(a.id)}
                className={`w-full text-left px-3 py-1.5 text-sm ${activityId === a.id ? "bg-amber-50" : "hover:bg-stone-50"}`}
              >
                <div className="font-medium text-stone-900">{a.name}</div>
                <div className="text-[10px] text-stone-500">{a.taskCode}</div>
              </button>
            ))}
            {filteredActivities.length === 0 && (
              <div className="px-3 py-2 text-xs text-stone-500">No matches.</div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Achieved (today)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={achieved}
              onChange={(e) => setAchieved(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Cumulative (running total)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={cumulative}
              onChange={(e) => setCumulative(e.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
            />
          </Field>
        </div>

        <Field label="Contractor">
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:border-stone-900"
          >
            <option value="">— None —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Labour breakdown">
          <div className="space-y-2">
            {labour.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.category}
                  onChange={(e) => updateLabour(i, { category: e.target.value })}
                  className="flex-1 rounded-md border border-stone-300 px-2 py-1 text-xs bg-white"
                >
                  {LABOUR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={row.count}
                  onChange={(e) => updateLabour(i, { count: Number(e.target.value) })}
                  className="w-20 rounded-md border border-stone-300 px-2 py-1 text-xs text-right tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => removeLabourRow(i)}
                  className="p-1 text-stone-400 hover:text-red-600"
                  aria-label="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addLabourRow}
              className="text-xs text-stone-700 hover:text-stone-900 underline-offset-2 hover:underline"
            >
              + Add category
            </button>
          </div>
        </Field>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional"
            className="w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:border-stone-900"
          />
        </Field>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={onClose}
            className="text-sm rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="text-sm rounded-md bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 disabled:opacity-60"
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create entry"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ----- BulkCsvDialog -----

function BulkCsvDialog({
  activities,
  contractors,
  onClose,
  onComplete,
}: {
  projectId: string;
  activities: ActivityOption[];
  contractors: ContractorOption[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setPending(true);
    setError(null);
    setProgress("Reading file…");

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      setError("CSV is empty or has no header row.");
      setPending(false);
      return;
    }

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const need = ["date", "activitycode", "achievedqty", "cumulativeqty"];
    for (const k of need) {
      if (!header.includes(k)) {
        setError(`Missing required column: ${k}. Expected: date, activityCode, achievedQty, cumulativeQty, contractor (optional), notes (optional), Skilled, Unskilled, Mason, Helper, Supervisor (all optional).`);
        setPending(false);
        return;
      }
    }

    const idx: Record<string, number> = {};
    header.forEach((h, i) => (idx[h] = i));

    const activityByCode = new Map(activities.map((a) => [a.taskCode.toLowerCase(), a]));
    const contractorByName = new Map(
      contractors.map((c) => [c.name.toLowerCase(), c]),
    );

    let created = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const code = cells[idx["activitycode"]]?.trim().toLowerCase();
      const a = code ? activityByCode.get(code) : null;
      if (!a) {
        errors.push(`Row ${i + 1}: activity code "${code}" not found`);
        continue;
      }
      const date = cells[idx["date"]]?.trim();
      if (!date) {
        errors.push(`Row ${i + 1}: missing date`);
        continue;
      }
      const labour: { category: string; count: number }[] = [];
      for (const cat of LABOUR_CATEGORIES) {
        const colIdx = idx[cat.toLowerCase()];
        if (colIdx == null) continue;
        const n = Number(cells[colIdx] ?? 0);
        if (Number.isFinite(n) && n > 0) labour.push({ category: cat, count: Math.floor(n) });
      }
      const contractorName = cells[idx["contractor"]]?.trim();
      const contractorMatch = contractorName ? contractorByName.get(contractorName.toLowerCase()) : null;

      setProgress(`Importing row ${i} of ${lines.length - 1}…`);
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wbsNodeId: a.id,
          date,
          achievedQuantity: Number(cells[idx["achievedqty"]] ?? 0),
          cumulativeQuantity: Number(cells[idx["cumulativeqty"]] ?? 0),
          contractorId: contractorMatch?.id ?? null,
          notes: idx["notes"] != null ? cells[idx["notes"]] : undefined,
          labour,
        }),
      });
      if (res.ok) created += 1;
      else errors.push(`Row ${i + 1}: ${res.status} ${res.statusText}`);
    }

    setPending(false);
    if (errors.length > 0) {
      setError(`Created ${created} entries. ${errors.length} errors:\n${errors.slice(0, 8).join("\n")}`);
    } else {
      setProgress(`Created ${created} entries.`);
      setTimeout(onComplete, 800);
    }
  }

  return (
    <Dialog onClose={onClose} title="Bulk upload progress entries">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-xs text-stone-600 leading-relaxed">
          <p>Upload a CSV with these columns (case-insensitive, comma-separated):</p>
          <code className="block mt-1 p-2 bg-stone-50 border border-stone-200 rounded text-[11px]">
            date,activityCode,achievedQty,cumulativeQty,contractor,notes,Skilled,Unskilled,Mason,Helper,Supervisor
          </code>
          <p className="mt-2 text-stone-500">
            <strong>date</strong> as YYYY-MM-DD. <strong>activityCode</strong> matches the WBS code (e.g.
            AMV.1.1.1). Last 5 columns are labour counts per category.
          </p>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-md file:border-0 file:bg-stone-900 file:text-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />

        {progress && (
          <p className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-md px-3 py-2">
            {progress}
          </p>
        )}

        {error && (
          <pre className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 whitespace-pre-wrap">
            {error}
          </pre>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
          <button
            type="button"
            onClick={onClose}
            className="text-sm rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={pending || !file}
            className="text-sm rounded-md bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 disabled:opacity-60"
          >
            {pending ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

// ----- Dialog primitive -----

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 backdrop-blur-sm overflow-y-auto p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-stone-200 shadow-elevated w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 p-1 rounded-md hover:bg-stone-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
