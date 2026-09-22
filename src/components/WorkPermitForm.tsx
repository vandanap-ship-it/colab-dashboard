"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PhotoPicker from "./PhotoPicker";
import SaveSuccessCard from "./SaveSuccessCard";
import HowThisWorks from "./HowThisWorks";
import { useToast } from "./Toast";
import { ScreenHeading, FieldLabel, PrimaryAction } from "./mobile/ui";
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
 * as the other mobile forms (progress, manpower) — try direct POST,
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
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] focus:outline-none focus:border-ink";

  return (
    <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
      {/* Project name lives in the layout header — don't repeat it here. */}
      <ScreenHeading
        title="Raise a work permit"
        lede="Needs approval before work starts."
      />

      <HowThisWorks
        title="How to request a work permit"
        storageKey="siddhi.htw.permit"
        steps={[
          "Pick the permit type — Hot Work (welding, grinding), Night Work, Deshuttering, or General.",
          "Give it a short title so approvers can tell what it's for at a glance (e.g. \"Rebar welding on V12 slab\").",
          "Write a short description of what's actually going to happen on site.",
          "Pick the work date, plus start and end times.",
          "Say where on site — the location or villa.",
          "Pick who should approve it. Safety officer for Hot Work / Night Work; planner for General / Deshuttering.",
          "Add photos of prep or site conditions if they help the approver decide.",
          "Tap Submit. The approver gets a push and can approve or reject from their phone.",
        ]}
      />

      {/* Type — segmented picker so all four fit on-screen without scrolling */}
      <div>
        <FieldLabel>What kind of work?</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {WORK_PERMIT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                type === t
                  ? "border-ink bg-ink text-cream"
                  : "border-sandstone-100 bg-cream text-ink"
              }`}
            >
              <div className="text-[14px] font-semibold">{WORK_PERMIT_TYPE_LABELS[t]}</div>
              <div
                className={`text-[11px] mt-0.5 ${
                  type === t ? "text-cream/70" : "text-ink-3"
                }`}
              >
                {WORK_PERMIT_TYPE_HINTS[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <FieldLabel>Short title</FieldLabel>
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Welding of column reinforcement — Villa 14"
          maxLength={200}
        />
      </label>

      <label className="block">
        <FieldLabel optional>Description</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[80px]`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Extra context for the approver."
          maxLength={2000}
        />
      </label>

      {/* Photos moved up from bottom of form — a permit request photo is
          often the fastest way to give the approver context (drawing
          markup, site condition, blocked area). */}
      <div>
        <FieldLabel hint="A photo tells the approver the story faster than words." optional>
          Photos (up to 6)
        </FieldLabel>
        <PhotoPicker photos={photos} setPhotos={setPhotos} max={6} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <FieldLabel>Date</FieldLabel>
          <input
            type="date"
            className={inputCls}
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </label>
        <label className="block">
          <FieldLabel>Start</FieldLabel>
          <input
            type="time"
            className={inputCls}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="block">
          <FieldLabel>End</FieldLabel>
          <input
            type="time"
            className={inputCls}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <FieldLabel optional>Location</FieldLabel>
        <input
          className={inputCls}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Villa 14 · Ground floor · Column bay 3"
          maxLength={200}
        />
      </label>

      <label className="block">
        <FieldLabel optional>Contractor</FieldLabel>
        <select
          className={inputCls}
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
        <FieldLabel hint="Pick at least one. Any of them can approve — first approver wins.">
          Who should approve?
        </FieldLabel>
        <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-lg border border-sandstone-100 bg-cream p-2">
          {approverOptions.length === 0 ? (
            <p className="text-[13px] text-ink-3 px-2 py-2">
              No approvers available. Ask an admin to provision an internal user.
            </p>
          ) : (
            approverOptions.map((u) => {
              const checked = selectedApprovers.has(u.id);
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-2 cursor-pointer ${
                    checked ? "bg-sandstone-100" : "hover:bg-sandstone-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleApprover(u.id)}
                    className="w-4 h-4 accent-ferrous-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] text-ink">{u.name}</div>
                    <div className="text-[11px] text-ink-3">
                      @{u.username} · {u.role}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
      </div>

      {error && (
        <p className="text-[13px] text-ferrous-700 bg-ferrous-50 border border-ferrous-100 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <PrimaryAction disabled={pending}>
        {pending ? "Submitting…" : "Raise permit"}
      </PrimaryAction>

      {!isFullAccess && (
        <p className="text-[12px] text-ink-3 text-center">
          You&apos;ll get notified when an approver acts on this permit.
        </p>
      )}
    </form>
  );
}
