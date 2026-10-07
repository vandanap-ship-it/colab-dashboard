"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

/**
 * Bottom half of the "Submit for sign-off" screen: the sheet date, an
 * optional remark for the approver, and the Submit button. The table
 * above it is server-rendered from the same rows the API will freeze.
 */
export default function RegisterSubmitForm({
  projectId,
  typeCode,
  todayIso,
  overdueCount,
}: {
  projectId: string;
  typeCode: string;
  todayIso: string;
  overdueCount: number;
}) {
  const router = useRouter();
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per screen visit so a double tap or a retry after a dropped
  // response can't create two sign-offs.
  const key = useRef<string>(crypto.randomUUID());

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/registers/${typeCode}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asOfDate, remark: remark.trim() || null, idempotencyKey: key.current }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't submit.");
        setSaving(false);
        return;
      }
      router.replace(`/mobile/${projectId}/registers/${typeCode}/submissions/${data.submission.id}?submitted=1`);
      router.refresh();
    } catch {
      setError("No connection. Check your signal and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {overdueCount > 0 && (
        <p className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-800 text-[12px] p-2.5">
          {overdueCount} item{overdueCount === 1 ? " is" : "s are"} past the due date (highlighted). You can still
          submit; the approver will see them flagged.
        </p>
      )}
      <div>
        <label htmlFor="as-of" className="block text-[13px] font-semibold text-stone-700 mb-1">
          Sheet date
        </label>
        <input
          id="as-of"
          type="date"
          value={asOfDate}
          max={todayIso}
          onChange={(e) => setAsOfDate(e.target.value)}
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px]"
        />
      </div>
      <div>
        <label htmlFor="remark" className="block text-[13px] font-semibold text-stone-700 mb-1">
          Note for the approver <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <textarea
          id="remark"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="e.g. FE-04 sent for refilling, replacement installed as FE-16"
          className="w-full min-h-20 rounded-lg border border-stone-300 bg-white p-2.5 text-[15px]"
          maxLength={2000}
        />
      </div>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2.5">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={saving || !asOfDate}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Submit for sign-off
      </button>
    </div>
  );
}
