"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";

export default function MobileExpenseForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidTo, setPaidTo] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (description.trim().length < 2) {
      setError("Add a short description.");
      return;
    }
    if (!(Number(amount) > 0)) {
      setError("Amount must be greater than 0.");
      return;
    }
    setPending(true);
    setError(null);

    // Receipt photos are uploaded inline; failure is non-blocking (the expense
    // itself still saves), matching the other mobile forms.
    let photoUrls: string[] = [];
    let photoWarning: string | null = null;
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `expense-${projectId}`);
      for (const p of photos) fd.append("file", p);
      try {
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) {
          photoUrls = (await upRes.json()).urls;
        } else {
          const data = await upRes.json().catch(() => null);
          photoWarning = data?.error ?? `Photo upload failed (status ${upRes.status})`;
        }
      } catch (err) {
        photoWarning = err instanceof Error ? `Photo upload failed: ${err.message}` : "Photo upload failed";
      }
    }

    const payload = {
      // One stable key per submission, reused for the direct POST and any
      // offline-queue replay, so a lost response doesn't create a duplicate.
      idempotencyKey: crypto.randomUUID(),
      projectId,
      category,
      description: description.trim(),
      amount: Number(amount),
      date,
      paidTo,
      photoUrls,
    };

    let queued = false;
    try {
      const res = await fetch("/api/expenses", {
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
        await enqueue({ endpoint: "/api/expenses", method: "POST", body: payload, label: `Expense: ${description.trim()}` });
        queued = true;
      }
    } catch {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/expenses", method: "POST", body: payload, label: `Expense: ${description.trim()}` });
      queued = true;
    }
    setPending(false);

    const queuedNote = queued ? "Saved on this device. It will sync the moment you're back online." : null;
    if (photoWarning || queuedNote) {
      alert(["Expense saved.", queuedNote, photoWarning].filter(Boolean).join("\n\n"));
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
        <h1 className="text-2xl font-semibold text-stone-900">Log Expense</h1>
        <p className="text-xs text-stone-500 mt-1">Submit for planner / manager approval.</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Amount ₹</span>
        <input
          required
          type="number"
          inputMode="decimal"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Description</span>
        <input
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Sand 2 loads"
          className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Paid to <span className="text-stone-400">(optional)</span>
          </span>
          <input
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            placeholder="Vendor"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Receipt photo (optional)</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
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
        {pending ? "Saving…" : "Log expense"}
      </button>
    </form>
  );
}
