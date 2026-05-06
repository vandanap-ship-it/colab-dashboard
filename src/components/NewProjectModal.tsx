"use client";

import { useState } from "react";

export default function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("PLANNING");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        code: code || undefined,
        status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        address: address || undefined,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create");
      return;
    }
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ivory/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white rounded-xl border border-stone-200 p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-stone-900">New project</h2>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none" aria-label="Close">×</button>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Amanvana"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="AMV"
              className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm uppercase"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_HOLD">On hold</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Start date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">End date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-full border border-stone-300 text-sm px-4 py-2 hover:bg-ivory">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-full bg-stone-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-60">
            {pending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
