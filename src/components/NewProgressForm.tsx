"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import VoiceTextarea from "./VoiceTextarea";
import { useToast } from "./Toast";
import PhotoPicker from "./PhotoPicker";
import ActivityPicker from "./ActivityPicker";
import { HINDRANCE_REASONS } from "@/lib/hindranceReasons";

// Local selection state — enriched with the metadata the picker returned so
// the form can render the picked activity + preserve totalQuantity/unit for
// the % slider.
interface PickedActivity {
  id: string;
  name: string;
  taskCode: string;
  totalQuantity: number | null;
  unit: string | null;
  contractor: { id: string; name: string } | null;
  path: { blockCode: string; villaLabel: string; sectionName: string };
}

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
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [selected, setSelected] = useState<PickedActivity | null>(null);
  const activityId = selected?.id ?? "";
  const [date, setDate] = useState(today);
  const [achieved, setAchieved] = useState(0);
  const [cumulative, setCumulative] = useState(0);
  const [contractorId, setContractorId] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonNote, setReasonNote] = useState<string>("");
  const [labour, setLabour] = useState<{ category: string; count: number }[]>([
    { category: "Skilled", count: 0 },
  ]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const conRes = await fetch(`/api/admin/contractors?projectId=${projectId}`, { cache: "no-store" });
      if (conRes.ok) {
        const data = await conRes.json();
        setContractors(data.contractors);
      }
    })();
  }, [projectId]);

  const totalQty = selected?.totalQuantity ?? 0;
  const pct = totalQty > 0 ? Math.max(0, Math.min(100, (cumulative / totalQty) * 100)) : 0;

  // Auto-pick contractor if the newly-picked activity has one tagged.
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

    // Try to upload photos inline first (fast path). If the online upload
    // fails, we queue the whole entry WITH the raw photo blobs — the offline
    // queue's upload step will retry the photos on flush and then fire the
    // main entry POST. Nothing gets saved to prod without its photos.
    let photoUrls: string[] = [];
    let photosNeedQueue: { filename: string; scope: string; blob: Blob }[] = [];
    if (photos.length > 0) {
      const scope = `progress-${projectId}`;
      const fd = new FormData();
      fd.set("scope", scope);
      for (const p of photos) fd.append("file", p);
      try {
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) {
          const upData = await upRes.json();
          photoUrls = upData.urls;
        } else {
          photosNeedQueue = photos.map((f) => ({ filename: f.name, scope, blob: f }));
        }
      } catch {
        photosNeedQueue = photos.map((f) => ({ filename: f.name, scope, blob: f }));
      }
    }

    const payload = {
      // One stable key per submission, reused for the direct POST and any
      // offline-queue replay, so a lost response doesn't create a duplicate.
      idempotencyKey: crypto.randomUUID(),
      wbsNodeId: activityId,
      date,
      type: "LABOUR_SUPPLY",
      achievedQuantity: achieved,
      cumulativeQuantity: cumulative,
      contractorId: contractorId || null,
      notes,
      labour,
      photoUrls,
      reasonCode: reasonCode || undefined,
      reasonNote: reasonNote.trim() || undefined,
    };
    const entryLabel = `Progress for ${selected?.name ?? "activity"}`;

    // Photos couldn't upload → queue the WHOLE entry with raw blobs. Skip the
    // online entry POST entirely so we don't create an entry without its
    // photos.
    if (photosNeedQueue.length > 0) {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({
        endpoint: "/api/progress",
        method: "POST",
        body: payload,
        label: entryLabel,
        photos: photosNeedQueue,
        photosField: "photoUrls",
      });
      setPending(false);
      toast.info("Saved on this device. Photos will upload when you're back online.");
      router.push(`/mobile/${projectId}`);
      router.refresh();
      return;
    }

    // Try the network first. If it succeeds, great — entry is saved and we
    // navigate away. If it fails (offline, slow signal, server hiccup), we
    // drop the entry into the offline queue.
    let saved = false;
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        saved = true;
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else {
        // 5xx — queue it and let the user keep moving.
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/progress", method: "POST", body: payload, label: entryLabel });
      }
    } catch {
      // Network error → queue.
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/progress", method: "POST", body: payload, label: entryLabel });
    }
    setPending(false);

    // Always confirm the save — pre-toast, an online save with no warnings
    // showed NO feedback at all, and engineers on slow networks would
    // double-submit thinking nothing happened.
    if (saved) {
      toast.success("Progress saved.");
    } else {
      toast.info("Saved on this device. It will sync when you're back online.");
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
        <div className="text-sm font-medium text-stone-700">Activity</div>
        {selected ? (
          <div className="rounded-md border border-stone-200 bg-white px-3 py-2.5 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-900 truncate">{selected.name}</div>
              <div className="text-[11px] text-stone-500 truncate">
                Block {selected.path.blockCode} · {selected.path.villaLabel} · {selected.path.sectionName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 flex-shrink-0"
              aria-label="Change activity"
            >
              <Pencil className="w-3 h-3" />
              Change
            </button>
          </div>
        ) : (
          <ActivityPicker
            projectId={projectId}
            initialActivityId={initialActivityId}
            onPick={(a) => {
              setSelected(a);
              setCumulative(0); // reset for fresh entry
            }}
          />
        )}
      </div>

      {selected && (
        <>
          <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
            {totalQty > 0 ? (
              <>
                <div>
                  <div className="text-xs text-stone-500">Quantity {pct.toFixed(1)}%</div>
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
                      inputMode="decimal"
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
                      inputMode="decimal"
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
                  inputMode="numeric"
                  value={row.count}
                  onChange={(e) => updateLabour(i, { count: Math.max(0, Math.floor(Number(e.target.value))) })}
                  className="w-24 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                />
                {labour.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLabourRow(i)}
                    // min-h/min-w-11 (~44px) — Apple/Google minimum tap target.
                    className="text-stone-400 hover:text-red-500 text-lg min-h-11 min-w-11 flex items-center justify-center"
                    aria-label="Remove"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>

          <PhotoPicker photos={photos} setPhotos={setPhotos} max={4} label="Photos" />

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

          <label className="block">
            <span className="text-sm font-medium text-stone-700">
              Reason for delay <span className="text-stone-400">(optional)</span>
            </span>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— No delay</option>
              {HINDRANCE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>

          {reasonCode && (
            <label className="block">
              <span className="text-sm font-medium text-stone-700">
                Reason detail <span className="text-stone-400">(optional)</span>
              </span>
              <input
                type="text"
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                maxLength={500}
                placeholder="e.g. cement delivery skipped for the day"
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
              />
            </label>
          )}
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
