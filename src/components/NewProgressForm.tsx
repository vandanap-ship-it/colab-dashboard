"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import VoiceTextarea from "./VoiceTextarea";

type Activity = {
  id: string;
  name: string;
  taskCode: string;
  path: string[];
  totalQuantity: number | null;
  unit: string | null;
  contractor: { id: string; name: string; category: string } | null;
};

type Contractor = { id: string; name: string; category: string };

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

export default function NewProgressForm({
  projectId,
  initialActivityId,
}: {
  projectId: string;
  initialActivityId?: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [activityId, setActivityId] = useState(initialActivityId ?? "");
  const [activitySearch, setActivitySearch] = useState("");
  const [date, setDate] = useState(today);
  const [achieved, setAchieved] = useState(0);
  const [cumulative, setCumulative] = useState(0);
  const [contractorId, setContractorId] = useState<string>("");
  const [labour, setLabour] = useState<{ category: string; count: number }[]>([
    { category: "Skilled", count: 0 },
  ]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [wbsRes, conRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" }),
        fetch(`/api/admin/contractors?projectId=${projectId}`, { cache: "no-store" }),
      ]);
      if (wbsRes.ok) {
        const data = await wbsRes.json();
        setActivities(data.nodes);
      }
      if (conRes.ok) {
        const data = await conRes.json();
        setContractors(data.contractors);
      }
    })();
  }, [projectId]);

  const filtered = useMemo(() => {
    if (!activities) return [];
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activities.slice(0, 50);
    return activities
      .filter((a) => a.name.toLowerCase().includes(q) || a.path.join(" / ").toLowerCase().includes(q))
      .slice(0, 50);
  }, [activities, activitySearch]);

  const selected = activities?.find((a) => a.id === activityId);
  const totalQty = selected?.totalQuantity ?? 0;
  const pct = totalQty > 0 ? Math.max(0, Math.min(100, (cumulative / totalQty) * 100)) : 0;

  // Auto-pick contractor if activity has one assigned
  useEffect(() => {
    if (selected?.contractor && !contractorId) setContractorId(selected.contractor.id);
  }, [selected, contractorId]);

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
      setError("Pick an activity first");
      return;
    }
    setPending(true);
    setError(null);

    let photoUrls: string[] = [];
    let photoWarning: string | null = null;
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `progress-${projectId}`);
      for (const p of photos) fd.append("file", p);
      try {
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) {
          const upData = await upRes.json();
          photoUrls = upData.urls;
        } else {
          // Don't block the entry on photo failure — save the entry without
          // photos and surface a warning so the user can retry photo upload
          // from the entry's edit screen later.
          const data = await upRes.json().catch(() => null);
          photoWarning = data?.error ?? `Photo upload failed (status ${upRes.status})`;
        }
      } catch (e) {
        photoWarning = e instanceof Error ? `Photo upload failed: ${e.message}` : "Photo upload failed";
      }
    }

    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wbsNodeId: activityId,
        date,
        type: "LABOUR_SUPPLY",
        achievedQuantity: achieved,
        cumulativeQuantity: cumulative,
        contractorId: contractorId || null,
        notes,
        labour,
        photoUrls,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    if (photoWarning) {
      // Entry saved, but photos didn't. Tell the user before navigating.
      alert(`Progress entry saved.\n\n${photoWarning}\n\nYou can re-add photos by editing the entry.`);
    }
    router.push(`/mobile/${projectId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
      <div>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-stone-500 mb-2"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold text-stone-900">New Progress</h1>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Date</span>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 inline-block">
        Labour Supply
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Activity</span>
          <input
            type="text"
            placeholder="Search activity by name or location…"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        {activities === null ? (
          <p className="text-xs text-stone-500">Loading activities…</p>
        ) : activities.length === 0 ? (
          <p className="text-xs text-amber-600">No activities yet — import a schedule first.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-stone-200 divide-y divide-stone-100">
            {filtered.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => setActivityId(a.id)}
                className={`w-full text-left px-3 py-2 hover:bg-ivory ${
                  activityId === a.id ? "bg-amber-50" : ""
                }`}
              >
                <div className="text-sm font-medium text-stone-900">{a.name}</div>
                <div className="text-[10px] text-stone-500">{a.path.slice(0, -1).join(" / ") || a.taskCode}</div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-xs text-stone-500 px-3 py-2">No matches.</p>}
          </div>
        )}
      </div>

      {selected && (
        <>
          <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
            <div>
              <div className="text-xs text-stone-500">Selected</div>
              <div className="text-sm font-medium text-stone-900">{selected.name}</div>
              <div className="text-[10px] text-stone-500">{selected.path.slice(0, -1).join(" / ")}</div>
            </div>

            {totalQty > 0 ? (
              <>
                <div>
                  <div className="text-xs text-stone-500">Quantity {pct.toFixed(2)}%</div>
                  <input
                    type="range"
                    min={0}
                    max={totalQty}
                    step={0.1}
                    value={cumulative}
                    onChange={(e) => setCumulative(Number(e.target.value))}
                    className="mt-2 w-full"
                  />
                  <div className="flex justify-between text-[10px] text-stone-500">
                    <span>0 {selected.unit ?? "UNIT"}</span>
                    <span>
                      {totalQty} {selected.unit ?? "UNIT"}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-stone-500">Achieved today</div>
                    <input
                      type="number"
                      step="0.1"
                      value={achieved}
                      onChange={(e) => setAchieved(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-stone-500">Cumulative</div>
                    <input
                      type="number"
                      step="0.1"
                      value={cumulative}
                      onChange={(e) => setCumulative(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-600">
                No total quantity set on this activity — enter cumulative as a count below.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="block">
              <span className="text-sm font-medium text-stone-700">Contractor</span>
              <select
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value)}
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Choose contractor…</option>
                {contractors?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.category})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-stone-700">Labour</span>
              <button
                type="button"
                onClick={addLabourRow}
                className="text-xs text-amber-600 font-medium"
              >
                + Add row
              </button>
            </div>
            {labour.map((row, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={row.category}
                  onChange={(e) => updateLabour(i, { category: e.target.value })}
                  className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  {LABOUR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  value={row.count}
                  onChange={(e) => updateLabour(i, { count: Math.max(0, Math.floor(Number(e.target.value))) })}
                  className="w-24 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
                {labour.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLabourRow(i)}
                    className="text-stone-400 hover:text-red-500 text-lg px-2"
                    aria-label="Remove"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-stone-700">Photos (max 4)</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 4))}
              className="mt-1 block w-full text-sm text-stone-700 file:mr-4 file:rounded-full file:border-0 file:bg-stone-900 file:text-white file:px-4 file:py-2 file:text-sm file:font-medium"
            />
            {photos.length > 0 && (
              <p className="text-xs text-stone-500 mt-1">{photos.length} selected</p>
            )}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-stone-700">Notes</span>
            <div className="mt-1">
              <VoiceTextarea
                rows={3}
                value={notes}
                onChange={setNotes}
                placeholder="Optional comments"
              />
            </div>
          </label>
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || !activityId}
        className="w-full rounded-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save progress"}
      </button>
    </form>
  );
}
