"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import VoiceTextarea from "./VoiceTextarea";
import { useToast } from "./Toast";
import PhotoPicker from "./PhotoPicker";

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
  const toast = useToast();

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
  // After a successful save we swap the form for a "Saved!" success view
  // with clear next-action buttons (Add another / Home). Redirecting straight
  // to /mobile was disorienting — the toast flashed briefly and users
  // couldn't tell if their report actually saved.
  const [saved, setSaved] = useState<null | { queued: boolean }>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" });
        if (!r.ok) throw new Error(`WBS fetch failed: ${r.status}`);
        const d = (await r.json()) as { nodes?: Activity[] };
        if (!cancelled) setActivities(Array.isArray(d.nodes) ? d.nodes : []);
      } catch (e) {
        if (!cancelled) {
          setActivities([]); // exits the "Loading…" state instead of hanging forever
          setLoadError(e instanceof Error ? e.message : "Couldn't load activities");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
    let photoWarning: string | null = null;
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `${scope}-${projectId}`);
      for (const p of photos) fd.append("file", p);
      try {
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) {
          photoUrls = (await upRes.json()).urls;
        } else {
          // Don't block the report on a photo failure — submit without photos
          // and warn. The record itself is never lost.
          const data = await upRes.json().catch(() => null);
          photoWarning = data?.error ?? `Photo upload failed (status ${upRes.status})`;
        }
      } catch (e) {
        photoWarning = e instanceof Error ? `Photo upload failed: ${e.message}` : "Photo upload failed";
      }
    }

    const payload: Record<string, unknown> = {
      // One stable key per submission, reused for the direct POST and any
      // offline-queue replay, so a lost response doesn't create a duplicate.
      idempotencyKey: crypto.randomUUID(),
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

    // Network-first; on offline / 5xx, queue locally and let it sync later.
    // If the enqueue itself throws (Safari private mode, storage quota full,
    // IndexedDB blocked), surface an actual error instead of leaving the
    // button stuck on "Saving…" forever — that failure mode used to look to
    // the user like "the page hung then went away".
    let queued = false;
    async function queueOrFail(reason: string): Promise<boolean> {
      try {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint, method: "POST", body: payload, label: title });
        return true;
      } catch (qe) {
        setPending(false);
        setError(
          `Couldn't save (${reason}) and this device can't hold it offline: ${
            qe instanceof Error ? qe.message : "storage unavailable"
          }. Please try again or check the browser storage settings.`,
        );
        return false;
      }
    }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // saved
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else {
        const ok = await queueOrFail(`server error ${res.status}`);
        if (!ok) return;
        queued = true;
      }
    } catch {
      const ok = await queueOrFail("network error");
      if (!ok) return;
      queued = true;
    }
    setPending(false);

    if (queued) {
      toast.info("Saved on this device. It will sync when you're back online.");
    } else {
      toast.success(`${title} saved.`);
    }
    if (photoWarning) {
      toast.warning(photoWarning);
    }

    // Instead of redirecting immediately, show the success view. The
    // "Add another" / "Home" buttons let the user confirm the save
    // consciously — a redirect-flash was easy to miss on mobile.
    setSaved({ queued });
    router.refresh();
  }

  function startAnother() {
    // Reset the form fields to their defaults so the user can log the next
    // entry without leaving the page.
    setDescription("");
    setActivityId("");
    setActivitySearch("");
    setPhotos([]);
    const reset: Record<string, string | number> = {};
    for (const f of extraFields) {
      if (f.kind === "select") reset[f.key] = f.default;
      if (f.kind === "date") reset[f.key] = f.defaultToday ? new Date().toISOString().slice(0, 10) : "";
      if (f.kind === "number") reset[f.key] = "";
      if (f.kind === "text") reset[f.key] = f.default ?? "";
    }
    setExtras(reset);
    setError(null);
    setSaved(null);
  }

  if (saved) {
    return (
      <div className="px-4 py-8 space-y-6">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-2xl mb-3">
            ✓
          </div>
          <h2 className="text-xl font-semibold text-emerald-900">
            {title} saved
          </h2>
          {saved.queued ? (
            <p className="text-sm text-emerald-800 mt-2">
              You're offline — it's stored on this device and will sync as
              soon as you're back on signal.
            </p>
          ) : (
            <p className="text-sm text-emerald-800 mt-2">
              Saved to Amanvana. Your team can now see it.
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          <button
            type="button"
            onClick={startAnother}
            className="rounded-xl bg-stone-900 text-white text-base font-medium py-4 active:scale-[0.99] transition-all"
          >
            Add another
          </button>
          <button
            type="button"
            onClick={() => router.push(successPath)}
            className="rounded-xl bg-white border border-stone-200 text-stone-900 text-base font-medium py-4 active:scale-[0.99] transition-all"
          >
            Back to home
          </button>
        </div>
      </div>
    );
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

      {/* Photos sit right below Description on every mobile form — a photo
          taken now is the strongest evidence a site engineer can produce.
          Was previously at the bottom of the form; engineers scrolling
          through metadata often lost the moment before reaching the
          camera. */}
      <PhotoPicker photos={photos} setPhotos={setPhotos} max={4} label="Photos" />

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
        ) : loadError ? (
          <p className="text-xs text-red-600">
            {loadError}. Pull down to refresh or check your connection.
          </p>
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
