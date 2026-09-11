"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PhotoPicker from "./PhotoPicker";
import SaveSuccessCard from "./SaveSuccessCard";
import { useToast } from "./Toast";
import {
  WORK_PERMIT_TYPES,
  WORK_PERMIT_TYPE_HINTS,
  WORK_PERMIT_TYPE_LABELS,
  type WorkPermitType,
} from "@/lib/workPermit";

type ApproverCandidate = {
  id: string;
  name: string;
  username: string;
  role: string;
};

type Contractor = { id: string; name: string; category: string };

/**
 * Mobile-first form for raising a WorkPermit. Same offline-queue pattern
 * as the other mobile forms (progress, expense, manpower) — try direct POST,
 * fall through to IndexedDB queue on network / 5xx, surface 4xx errors
 * inline. Photos are uploaded inline; failure is non-blocking so the permit
 * itself still saves.
 */
export default function WorkPermitForm({
  projectId,
  projectName,
  currentUserId,
  approverCandidates,
  contractors,
  isFullAccess,
}: {
  projectId: string;
  projectName: string;
  currentUserId: string;
  approverCandidates: ApproverCandidate[];
  contractors: Contractor[];
  isFullAccess: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  // Requesters should never appear in their own approver picker — API also
  // enforces this (approver != requester at the state-machine layer), but
  // hiding the option up-front prevents confusion.
  const approverOptions = useMemo(
    () => approverCandidates.filter((u) => u.id !== currentUserId),
    [approverCandidates, currentUserId],
  );

  const [type, setType] = useState<WorkPermitType>("GENERAL");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [location, setLocation] = useState("");
  const [contractorId, setContractorId] = useState<string>("");
  const [selectedApprovers, setSelectedApprovers] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After save: in-place success card (Add another / Back to home) so
  // engineers raising back-to-back permits don't get bounced home each time.
  const [saved, setSaved] = useState<null | { queued: boolean; title: string }>(null);

  function toggleApprover(id: string) {
    setSelectedApprovers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 3) {
      setError("Give the permit a short title (3+ characters).");
      return;
    }
    if (selectedApprovers.size === 0) {
      setError("Pick at least one approver.");
      return;
    }
    // Client-side sanity — startTime should be before endTime (or you're
    // saying "starts at midnight tomorrow", which is a different permit).
    if (endTime <= startTime) {
      setError("End time must be after start time.");
      return;
    }
    setPending(true);

    // Photos uploaded inline. Failure is non-blocking — the permit still
    // saves without the photo, matching the other mobile forms.
    let photoUrls: string[] = [];
    let photoWarning: string | null = null;
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `work-permit-${projectId}`);
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
      idempotencyKey: crypto.randomUUID(),
      projectId,
      type,
      title: title.trim(),
      description: description.trim() || undefined,
      workDate,
      startTime,
      endTime,
      location: location.trim() || undefined,
      contractorId: contractorId || undefined,
      approverIds: Array.from(selectedApprovers),
      photoUrls,
    };

    let queued = false;
    try {
      const res = await fetch("/api/work-permits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // saved directly
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({
          endpoint: "/api/work-permits",
          method: "POST",
          body: payload,
          label: `Work permit: ${WORK_PERMIT_TYPE_LABELS[type]} · ${title.trim()}`,
        });
        queued = true;
      }
    } catch {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({
        endpoint: "/api/work-permits",
        method: "POST",
        body: payload,
        label: `Work permit: ${WORK_PERMIT_TYPE_LABELS[type]} · ${title.trim()}`,
      });
      queued = true;
    }
    setPending(false);

    if (queued) {
      toast.info("Saved on this device. Will sync + notify approvers when you're online.");
    } else {
      toast.success("Work permit raised — approvers notified.");
    }
    if (photoWarning) toast.warning(photoWarning);

    setSaved({ queued, title: title.trim() });
    router.refresh();
  }

  function resetForm() {
    setType("GENERAL");
    setTitle("");
    setDescription("");
    setWorkDate(new Date().toISOString().slice(0, 10));
    setStartTime("09:00");
    setEndTime("18:00");
    setLocation("");
    setContractorId("");
    setSelectedApprovers(new Set());
    setPhotos([]);
    setError(null);
    setSaved(null);
  }

  if (saved) {
    return (
      <SaveSuccessCard
        title="Permit raised"
        detail={`${saved.title} — approvers notified.`}
        projectId={projectId}
        onAddAnother={resetForm}
        queued={saved.queued}
      />
    );
  }

  const inputCls =
    "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-900";

  return (
    <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
      <div>
        <button type="button" onClick={() => router.back()} className="text-sm text-stone-500 mb-2">
          ← Back
        </button>
        <h1 className="text-2xl font-semibold text-stone-900">Raise Work Permit</h1>
        <p className="text-xs text-stone-500 mt-1">
          {projectName} · needs approval before work starts.
        </p>
      </div>

      {/* Type — segmented picker so all four fit on-screen without scrolling */}
      <div>
        <span className="text-sm font-medium text-stone-700">Type</span>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {WORK_PERMIT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                type === t
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-900"
              }`}
            >
              <div className="text-sm font-medium">{WORK_PERMIT_TYPE_LABELS[t]}</div>
              <div
                className={`text-[10px] mt-0.5 ${
                  type === t ? "text-stone-300" : "text-stone-500"
                }`}
              >
                {WORK_PERMIT_TYPE_HINTS[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">Short title</span>
        <input
          className={`${inputCls} mt-1`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Welding of column reinforcement — Villa 14"
          maxLength={200}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">
          Description <span className="text-stone-400 text-xs">(optional)</span>
        </span>
        <textarea
          className={`${inputCls} mt-1 min-h-[80px]`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Extra context for the approver."
          maxLength={2000}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Work date</span>
          <input
            type="date"
            className={`${inputCls} mt-1`}
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Start</span>
          <input
            type="time"
            className={`${inputCls} mt-1`}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">End</span>
          <input
            type="time"
            className={`${inputCls} mt-1`}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">
          Location <span className="text-stone-400 text-xs">(optional)</span>
        </span>
        <input
          className={`${inputCls} mt-1`}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Villa 14 · Ground floor · Column bay 3"
          maxLength={200}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-stone-700">
          Contractor <span className="text-stone-400 text-xs">(optional)</span>
        </span>
        <select
          className={`${inputCls} mt-1`}
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
        >
          <option value="">— none —</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.category})
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-sm font-medium text-stone-700">Approvers</span>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Pick at least one. Any of them can approve — first-approver-wins.
        </p>
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2">
          {approverOptions.length === 0 ? (
            <p className="text-xs text-stone-500 px-2 py-2">
              No approvers available. Ask an admin to provision an internal user.
            </p>
          ) : (
            approverOptions.map((u) => {
              const checked = selectedApprovers.has(u.id);
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-2 cursor-pointer ${
                    checked ? "bg-stone-100" : "hover:bg-stone-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleApprover(u.id)}
                    className="w-4 h-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-stone-900">{u.name}</div>
                    <div className="text-[10px] text-stone-500">
                      @{u.username} · {u.role}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div>
        <span className="text-sm font-medium text-stone-700">
          Photos <span className="text-stone-400 text-xs">(optional — max 6)</span>
        </span>
        <div className="mt-2">
          <PhotoPicker photos={photos} setPhotos={setPhotos} max={6} />
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 text-white text-sm font-medium py-3 hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Raise permit"}
      </button>

      {!isFullAccess && (
        <p className="text-[11px] text-stone-500 text-center">
          You&apos;ll get notified when an approver acts on this permit.
        </p>
      )}
    </form>
  );
}
