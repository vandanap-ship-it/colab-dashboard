"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Undo2 } from "lucide-react";

export default function RestoreButton({
  entityType,
  id,
}: {
  entityType: "ProgressEntry" | "Issue" | "Hindrance" | "Concern" | "Inspection";
  id: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function restore() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Restore failed");
        setPending(false);
        return;
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Restore failed");
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={restore}
      disabled={pending}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-stone-900 hover:text-stone-900 disabled:opacity-50"
    >
      <Undo2 className="w-3.5 h-3.5" />
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}
