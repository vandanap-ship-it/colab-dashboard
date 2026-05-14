"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import VoiceTextarea from "./VoiceTextarea";

type Activity = { id: string; name: string; taskCode: string; path: string[] };

type ExtraField =
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[]; default: string }
  | { kind: "date"; key: string; label: string; defaultToday?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; placeholder?: string }
  | { kind: "text"; key: string; label: string; placeholder?: string; default?: string };

export default function ReportForm({
  projectId,
  title,
  endpoint,
  successPath,
  primaryButtonLabel = "Save",
  scope = "report",
  extraFields = [],
}: {
  projectId: string;
  title: string;
  endpoint: string;
  successPath: string;
  primaryButtonLabel?: string;
  scope?: string;
  extraFields?: ExtraField[];
}) {
  const router = useRouter();

  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [activityId, setActivityId] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [extras, setExtras] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    for (const f of extraFields) {
      if (f.kind === "select") init[f.key] = f.default;
      if (f.kind === "date") init[f.key] = f.defaultToday ? new Date().toISOString().slice(0, 10) : "";
      if (f.kind === "number") init[f.key] = "";
      if (f.kind === "text") init[f.key] = f.default ?? "";
    }
    return init;
  });
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 3) {
      setError("Add a longer description");
      return;
    }
    setPending(true);
    setError(null);

    let photoUrls: string[] = [];
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `${scope}-${projectId}`);
      for (const p of photos) fd.append("file", p);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) {
        setPending(false);
        setError("Photo upload failed");
        return;
      }
      photoUrls = (await upRes.json()).urls;
    }

    const payload: Record<string, unknown> = {
      projectId,
      wbsNodeId: activityId || undefined,
      description: description.trim(),
      photoUrls,
      ...extras,
    };
    // Strip empty extras
    for (const k of Object.keys(extras)) {
      if (extras[k] === "" || extras[k] === undefined) delete payload[k];
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    router.push(successPath);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
      <div>
        <button type="button" onClick={() => router.back()} className="text-sm text-stone-500 mb-2">
          ← Back
        </button>
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Description</span>
        <div className="mt-1">
          <VoiceTextarea
            required
            rows={4}
            value={description}
            onChange={setDescription}
            placeholder="What's going on?"
          />
        </div>
      </label>

      {extraFields.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {extraFields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-medium text-stone-700">{f.label}</span>
              {f.kind === "select" ? (
                <select
                  value={String(extras[f.key] ?? f.default)}
                  onChange={(e) => setExtras((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.kind === "date" ? (
                <input
                  type="date"
                  value={String(extras[f.key] ?? "")}
                  onChange={(e) => setExtras((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
              ) : f.kind === "text" ? (
                <input
                  type="text"
                  placeholder={f.placeholder}
                  value={String(extras[f.key] ?? "")}
                  onChange={(e) => setExtras((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
              ) : (
                <input
                  type="number"
                  min={f.min ?? 0}
                  placeholder={f.placeholder}
                  value={String(extras[f.key] ?? "")}
                  onChange={(e) => setExtras((s) => ({ ...s, [f.key]: e.target.value === "" ? "" : Number(e.target.value) }))}
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
              )}
            </label>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Activity <span className="text-stone-400">(optional)</span>
          </span>
          <input
            type="text"
            placeholder="Search activity by name or location…"
            value={activitySearch}
            onChange={(e) => setActivitySearch(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        {activities === null ? (
          <p className="text-xs text-stone-500">Loading…</p>
        ) : (
          <div className="max-h-40 overflow-y-auto rounded-md border border-stone-200 divide-y divide-stone-100">
            <button
              type="button"
              onClick={() => setActivityId("")}
              className={`w-full text-left px-3 py-2 ${activityId === "" ? "bg-amber-50" : ""}`}
            >
              <div className="text-xs text-stone-500">No specific activity (project-level)</div>
            </button>
            {filtered.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => setActivityId(a.id)}
                className={`w-full text-left px-3 py-2 ${activityId === a.id ? "bg-amber-50" : ""}`}
              >
                <div className="text-sm font-medium text-stone-900">{a.name}</div>
                <div className="text-[10px] text-stone-500">{a.path.slice(0, -1).join(" / ") || a.taskCode}</div>
              </button>
            ))}
          </div>
        )}
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
        {photos.length > 0 && <p className="text-xs text-stone-500 mt-1">{photos.length} selected</p>}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Saving…" : primaryButtonLabel}
      </button>
    </form>
  );
}
