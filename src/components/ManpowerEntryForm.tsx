"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

export interface ContractorOption {
  id: string;
  name: string;
  category: string;
}

export interface ManpowerEntryFormProps {
  projectId: string;
  projectName: string;
  contractors: ContractorOption[];
  trades: string[];
}

/**
 * Mobile form for a site engineer to log actual manpower.
 *
 * Design decisions:
 *   - Date defaults to today (site engineers log same-day almost always).
 *   - One submission is one (contractor, trade, count). The upsert on the
 *     API side means a repeat submission for the same triple updates instead
 *     of duplicating — so the engineer can correct a mistake by re-submitting.
 *   - Offline resilience: on network failure or 5xx, queue via the same
 *     offlineQueue we use for progress + hindrance.
 */
export default function ManpowerEntryForm({
  projectId,
  projectName,
  contractors,
  trades,
}: ManpowerEntryFormProps) {
  const router = useRouter();
  const toast = useToast();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [entryDate, setEntryDate] = useState<string>(today);
  const [contractorId, setContractorId] = useState<string>(contractors[0]?.id ?? "");
  const [trade, setTrade] = useState<string>(trades[0] ?? "");
  const [actualCount, setActualCount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!contractorId) { setError("Pick a contractor"); return; }
    if (!trade) { setError("Pick a trade"); return; }
    const n = Number(actualCount);
    if (!Number.isFinite(n) || n < 0) { setError("Actual count must be a number"); return; }

    setPending(true);
    const payload = {
      idempotencyKey: crypto.randomUUID(),
      projectId,
      contractorId,
      trade,
      entryDate,
      actualCount: Math.floor(n),
      notes: notes.trim() || undefined,
    };

    let queued = false;
    try {
      const res = await fetch("/api/manpower-entries", {
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
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/manpower-entries", method: "POST", body: payload, label: "Manpower entry" });
        queued = true;
      }
    } catch {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/manpower-entries", method: "POST", body: payload, label: "Manpower entry" });
      queued = true;
    }
    setPending(false);

    if (queued) {
      toast.info("Saved on this device. It will sync when you're back online.");
    } else {
      toast.success("Manpower logged.");
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
        <h1 className="text-2xl font-semibold text-stone-900">Log manpower</h1>
        <p className="text-xs text-stone-500 mt-1">{projectName}</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Date</span>
        <input
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Contractor</span>
        <select
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {contractors.length === 0 && <option value="">No contractors on this project</option>}
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Trade</span>
        <select
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {trades.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Actual headcount on site</span>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={0}
          value={actualCount}
          onChange={(e) => setActualCount(e.target.value)}
          placeholder="0"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-lg tabular-nums"
        />
        <span className="mt-1 block text-xs text-stone-500">
          If you already logged this trade today, resubmitting will update the previous number.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">
          Notes <span className="text-stone-400">(optional)</span>
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. 3 workers arrived late due to bus delay"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending || contractors.length === 0}
        className="w-full rounded-full bg-stone-900 text-white py-3 text-sm font-medium disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save entry"}
      </button>
    </form>
  );
}
