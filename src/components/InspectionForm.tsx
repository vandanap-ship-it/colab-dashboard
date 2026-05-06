"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Activity = { id: string; name: string; taskCode: string; path: string[] };

const DEFAULT_ITEMS = [
  "All work matches drawings",
  "Materials per spec",
  "Workmanship quality acceptable",
  "Safety practices followed",
  "Site cleaned after work",
];

export default function InspectionForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [activityId, setActivityId] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<{ label: string; passed: boolean; notes: string }[]>(
    DEFAULT_ITEMS.map((label) => ({ label, passed: true, notes: "" })),
  );
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setActivities(d.nodes));
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

  function updateItem(i: number, patch: Partial<{ label: string; passed: boolean; notes: string }>) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addItem() {
    setItems((rows) => [...rows, { label: "", passed: true, notes: "" }]);
  }
  function removeItem(i: number) {
    setItems((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) {
      setError("Title too short");
      return;
    }
    const usable = items.filter((i) => i.label.trim().length > 0);
    if (usable.length === 0) {
      setError("Add at least one item");
      return;
    }
    setPending(true);
    setError(null);

    let photoUrls: string[] = [];
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `inspection-${projectId}`);
      for (const p of photos) fd.append("file", p);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) {
        setPending(false);
        setError("Photo upload failed");
        return;
      }
      photoUrls = (await upRes.json()).urls;
    }

    const res = await fetch("/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        wbsNodeId: activityId || undefined,
        title: title.trim(),
        items: usable,
        photoUrls,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    router.push(`/mobile/${projectId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
      <div>
        <button type="button" onClick={() => router.back()} className="text-sm text-stone-500 mb-2">
          ← Back
        </button>
        <h1 className="text-2xl font-semibold text-stone-900">Inspection Checklist</h1>
        <p className="text-xs text-stone-500 mt-1">Submit for planner review.</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Title</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Earth Bedroom — Final paint check"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Activity <span className="text-stone-400">(optional)</span>
          </span>
          <input
            type="text"
            placeholder="Search activity…"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <div className="max-h-40 overflow-y-auto rounded-md border border-stone-200 divide-y divide-stone-100">
          <button
            type="button"
            onClick={() => setActivityId("")}
            className={`w-full text-left px-3 py-2 ${activityId === "" ? "bg-amber-50" : ""}`}
          >
            <div className="text-xs text-stone-500">No specific activity</div>
          </button>
          {filtered.map((a) => (
            <button
              type="button"
              key={a.id}
              onClick={() => setActivityId(a.id)}
              className={`w-full text-left px-3 py-2 ${activityId === a.id ? "bg-amber-50" : ""}`}
            >
              <div className="text-sm font-medium text-stone-900">{a.name}</div>
              <div className="text-[10px] text-stone-500">{a.path.slice(0, -1).join(" / ")}</div>
            </button>
          ))}
        </div>
        {selected && (
          <p className="text-xs text-stone-600">Selected: {selected.name}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">Checklist items</span>
          <button type="button" onClick={addItem} className="text-xs text-amber-600 font-medium">
            + Add item
          </button>
        </div>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
              <div className="flex gap-2 items-start">
                <input
                  type="text"
                  value={it.label}
                  onChange={(e) => updateItem(i, { label: e.target.value })}
                  placeholder="Item label"
                  className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="text-stone-400 hover:text-red-500 text-sm px-2"
                    aria-label="Remove"
                  >
                    🗑
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateItem(i, { passed: true })}
                  className={`flex-1 text-xs font-medium rounded-full py-1.5 ${
                    it.passed ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  ✓ Pass
                </button>
                <button
                  type="button"
                  onClick={() => updateItem(i, { passed: false })}
                  className={`flex-1 text-xs font-medium rounded-full py-1.5 ${
                    !it.passed ? "bg-red-500 text-white" : "bg-stone-100 text-stone-500"
                  }`}
                >
                  ✕ Fail
                </button>
              </div>
              {!it.passed && (
                <input
                  type="text"
                  value={it.notes}
                  onChange={(e) => updateItem(i, { notes: e.target.value })}
                  placeholder="What's wrong?"
                  className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-xs"
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Photos (max 8)</span>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 8))}
          className="mt-1 block w-full text-sm text-stone-700 file:mr-4 file:rounded-full file:border-0 file:bg-stone-900 file:text-white file:px-4 file:py-2 file:text-sm file:font-medium"
        />
        {photos.length > 0 && <p className="text-xs text-stone-500 mt-1">{photos.length} selected</p>}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
