"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  RFI_CATEGORIES,
  RFI_CATEGORY_LABELS,
  RFI_PRIORITIES,
  RFI_PRIORITY_LABELS,
  type RfiCategory,
  type RfiPriority,
} from "@/lib/rfi";

export interface RfiFormProps {
  projectId: string;
  users: Array<{ id: string; name: string }>;   // pool of assignable users
  redirectTo?: string;                          // e.g. `/projects/${id}/rfi`
}

export default function RfiForm({ projectId, users, redirectTo }: RfiFormProps) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RfiCategory>("STRUCTURAL");
  const [priority, setPriority] = useState<RfiPriority>("MEDIUM");
  const [assignedToId, setAssignedToId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/rfi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          subject,
          description,
          category,
          priority,
          assignedToId: assignedToId || null,
          dueDate: dueDate || null,
          idempotencyKey: `rfi-${projectId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create RFI" }));
        throw new Error(body.error ?? "Failed to create RFI");
      }
      const { rfi } = await res.json();
      router.push(redirectTo ?? `/projects/${projectId}/rfi/${rfi.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Foundation depth vs drawing on Villa 28"
          className={`${inputCls} mt-1`}
          maxLength={200}
          required
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Question</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Explain the situation and what you need clarified. Include drawing refs, dimensions, dates."
          className={`${inputCls} mt-1 min-h-[140px]`}
          maxLength={4000}
          required
        />
        <span className="block text-[10px] text-stone-400 mt-1">{description.length} / 4000</span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as RfiCategory)}
            className={`${inputCls} mt-1`}
          >
            {RFI_CATEGORIES.map((c) => (
              <option key={c} value={c}>{RFI_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as RfiPriority)}
            className={`${inputCls} mt-1`}
          >
            {RFI_PRIORITIES.map((p) => (
              <option key={p} value={p}>{RFI_PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Assign to (optional)</span>
          <select
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            className={`${inputCls} mt-1`}
          >
            <option value="">— unassigned —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <span className="block text-[10px] text-stone-400 mt-1">Assignee gets an email when set.</span>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Response needed by (optional)</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`${inputCls} mt-1`}
          />
        </label>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
        >
          {submitting ? "Raising..." : "Raise RFI"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-stone-200 bg-white text-stone-700 px-4 py-2 text-sm font-medium hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
