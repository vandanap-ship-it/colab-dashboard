"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PhotoPicker from "./PhotoPicker";
import SaveSuccessCard from "./SaveSuccessCard";
import HowThisWorks from "./HowThisWorks";
import { useToast } from "./Toast";
import { FieldLabel } from "./mobile/ui";
import {
  WORK_PERMIT_TYPES,
  WORK_PERMIT_TYPE_HINTS,
  WORK_PERMIT_TYPE_LABELS,
  WORK_PERMIT_CHECKPOINTS,
  isValidPermitTimeWindow,
  type WorkPermitType,
} from "@/lib/workPermit";
import { istDayString } from "@/lib/istDay";

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

  // Colab-parity per-checkpoint responses. Keyed by permit type so
  // switching types (e.g. General → Hot Work) doesn't leak answers
  // between templates — the fresh type starts every row unanswered.
  type ChecklistAnswer = { passed: boolean | null; remark: string; photoUrl: string };
  const [checklistState, setChecklistState] = useState<Record<WorkPermitType, ChecklistAnswer[]>>(() => {
    const seed: Record<string, ChecklistAnswer[]> = {};
    for (const t of WORK_PERMIT_TYPES) {
      seed[t] = WORK_PERMIT_CHECKPOINTS[t].map(() => ({ passed: null, remark: "", photoUrl: "" }));
    }
    return seed as Record<WorkPermitType, ChecklistAnswer[]>;
  });
  const activeChecklist = checklistState[type];
  function setChecklistAnswer(idx: number, patch: Partial<ChecklistAnswer>) {
    setChecklistState((prev) => {
      const next = { ...prev };
      const arr = next[type].slice();
      arr[idx] = { ...arr[idx], ...patch };
      next[type] = arr;
      return next;
    });
  }
  // Per-checkpoint photo upload state — Colab-parity, camera icon inline
  // with each row. Uploads to /api/upload immediately (same endpoint the
  // top-level PhotoPicker uses) so the URL rides in the payload.
  const [uploadingCheckpointIdx, setUploadingCheckpointIdx] = useState<number | null>(null);
  async function uploadCheckpointPhoto(idx: number, file: File) {
    // Guard against a rapid double-tap on the same checkpoint's camera
    // — React state batching means the icon's disabled state lags one
    // render, so two files could enter this handler back-to-back,
    // racing two uploads and leaking one orphan blob per race.
    if (uploadingCheckpointIdx !== null) return;
    setUploadingCheckpointIdx(idx);
    try {
      const fd = new FormData();
      fd.set("scope", `permit-checkpoint-${projectId}`);
      fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) return;
      const { urls } = (await up.json()) as { urls: string[] };
      const url = urls[0];
      if (url) setChecklistAnswer(idx, { photoUrl: url });
    } finally {
      setUploadingCheckpointIdx(null);
    }
  }
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workDate, setWorkDate] = useState(istDayString());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [location, setLocation] = useState("");
  const [contractorId, setContractorId] = useState<string>("");
  const [selectedApprovers, setSelectedApprovers] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Colab-parity 4-step wizard state. Step numbers match the header
  // pattern "Step N of 4 — [name]". State stays flat across steps so
  // Back doesn't lose entered data.
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Colab-parity Step 2 additions.
  type LabourEntry = { workerName: string; role: string; count: string };
  const [labourEntries, setLabourEntries] = useState<LabourEntry[]>([]);
  // Colab-parity: Night Work permit has a dedicated "Details of
  // Personnel in Attendance" section (Abhishek zip). Same row shape as
  // labour but the semantic is named supervisors / safety officers on
  // site during night hours. Kept as a separate state slice so the two
  // lists render as two distinct cards; the API `kind` field splits
  // them on write.
  const [personnelEntries, setPersonnelEntries] = useState<LabourEntry[]>([]);
  const [coRequesterIds, setCoRequesterIds] = useState<Set<string>>(new Set());
  const [activityHead, setActivityHead] = useState<string>("");
  // Per-approver capabilities picked in Step 2 (Colab shows two chips
  // per approver row: Can Close green + Can Suspend amber).
  type ApproverCap = { canClose: boolean; canSuspend: boolean };
  const [approverCaps, setApproverCaps] = useState<Record<string, ApproverCap>>({});
  function setCap(userId: string, patch: Partial<ApproverCap>) {
    setApproverCaps((prev) => ({
      ...prev,
      [userId]: {
        canClose: prev[userId]?.canClose ?? true,
        canSuspend: prev[userId]?.canSuspend ?? false,
        ...patch,
      },
    }));
  }
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
    if (pending) return; // guard against a fast double-tap on Submit Permit
    setError(null);
    if (title.trim().length < 3) {
      setError("Give the permit a short title (3+ characters).");
      return;
    }
    if (selectedApprovers.size === 0) {
      setError("Pick at least one approver.");
      return;
    }
    if (!isValidPermitTimeWindow(type, startTime, endTime)) {
      setError(
        type === "NIGHT_WORK"
          ? "Start and end time can't be the same."
          : "End time must be after start time.",
      );
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

    // Colab-parity: attach the Step-3 checklist. Skip rows that are
    // still unanswered — a truly empty checklist should round-trip as
    // an empty array so downstream consumers can distinguish "not
    // filled" from "all NO".
    const checklistResponses = WORK_PERMIT_CHECKPOINTS[type]
      .map((q, i) => {
        const a = activeChecklist[i];
        if (a.passed === null && !a.remark.trim() && !a.photoUrl) return null;
        return {
          q,
          passed: a.passed,
          remark: a.remark.trim() || undefined,
          photoUrl: a.photoUrl || undefined,
        };
      })
      .filter(
        (x): x is { q: string; passed: boolean | null; remark: string | undefined; photoUrl: string | undefined } =>
          x !== null,
      );

    // Colab-parity Step 2 additions on the payload:
    // - labourEntries (multi-add, free-text worker/role/count)
    // - coRequesterIds (multi-user picker)
    // - activityHead (Colab's Activity Head dropdown pick)
    // - approvers[] with per-user capabilities (canClose/canSuspend).
    //   The existing approverIds[] payload key stays for the current
    //   API contract; approvers[] rides alongside so the new endpoint
    //   can persist capabilities.
    const cleanLabour = labourEntries
      .map((r) => ({
        kind: "LABOUR" as const,
        workerName: r.workerName.trim() || undefined,
        role: r.role.trim() || undefined,
        count: r.count.trim() ? Number(r.count) : undefined,
      }))
      .filter((r) => r.workerName || r.role || (typeof r.count === "number" && Number.isFinite(r.count)));

    const cleanAttendance = personnelEntries
      .map((r) => ({
        kind: "ATTENDANCE" as const,
        workerName: r.workerName.trim() || undefined,
        role: r.role.trim() || undefined,
        count: r.count.trim() ? Number(r.count) : 1,
      }))
      .filter((r) => r.workerName || r.role);

    // Colab groups both under the same labourEntries[] payload — the API
    // splits them by `kind` on write. Only include ATTENDANCE rows when
    // the permit is Night Work (the section is hidden otherwise).
    const combinedLabour =
      type === "NIGHT_WORK"
        ? [...cleanLabour, ...cleanAttendance]
        : cleanLabour;

    const approverIdsArr = Array.from(selectedApprovers);
    const approversWithCaps = approverIdsArr.map((userId) => ({
      userId,
      levelIndex: 1,
      canClose: approverCaps[userId]?.canClose ?? true,
      canSuspend: approverCaps[userId]?.canSuspend ?? false,
    }));

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
      approverIds: approverIdsArr,
      approvers: approversWithCaps,
      labourEntries: combinedLabour.length > 0 ? combinedLabour : undefined,
      coRequesterIds: coRequesterIds.size > 0 ? Array.from(coRequesterIds) : undefined,
      activityHead: activityHead.trim() || undefined,
      photoUrls,
      checklistResponses: checklistResponses.length > 0 ? checklistResponses : undefined,
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
    setWorkDate(istDayString());
    setStartTime("09:00");
    setEndTime("18:00");
    setLocation("");
    setContractorId("");
    setSelectedApprovers(new Set());
    setPhotos([]);
    // Step 2 collections must reset too on a hard "Add another" —
    // otherwise labour entries, co-requesters, personnel, activity head,
    // approver capabilities, and per-checkpoint answers from the just-
    // saved permit would silently carry into the next one.
    setLabourEntries([]);
    setPersonnelEntries([]);
    setCoRequesterIds(new Set());
    setActivityHead("");
    setApproverCaps({});
    // Reset every checklist template back to unanswered so the next
    // permit doesn't inherit Yes/No answers from the saved one.
    setChecklistState((prev) => {
      const next: Record<string, { passed: boolean | null; remark: string; photoUrl: string }[]> = {};
      for (const t of WORK_PERMIT_TYPES) {
        next[t] = WORK_PERMIT_CHECKPOINTS[t].map(() => ({ passed: null, remark: "", photoUrl: "" }));
      }
      void prev;
      return next as typeof prev;
    });
    setStep(1);
    setError(null);
    setSaved(null);
  }

  /**
   * Keep the picked type, location, contractor, and approver set —
   * everything a supervisor typically re-uses across permits raised
   * in the same shift (e.g. a run of Hot Work permits for the welding
   * team on the same slab). Only the title, description, and photos
   * reset; the date + times bump to their sensible defaults.
   */
  function resetForNextOfSameType() {
    setTitle("");
    setDescription("");
    setWorkDate(istDayString());
    setStartTime("09:00");
    setEndTime("18:00");
    setPhotos([]);
    // Labour + personnel reset because those are per-shift crews, not
    // per-run-of-permits state — a supervisor raising a Hot Work run
    // still enters fresh worker names each permit.
    setLabourEntries([]);
    setPersonnelEntries([]);
    // Reset checklist answers so the next permit gets fresh Yes/No.
    setChecklistState((prev) => {
      const next: Record<string, { passed: boolean | null; remark: string; photoUrl: string }[]> = {};
      for (const t of WORK_PERMIT_TYPES) {
        next[t] = WORK_PERMIT_CHECKPOINTS[t].map(() => ({ passed: null, remark: "", photoUrl: "" }));
      }
      void prev;
      return next as typeof prev;
    });
    setStep(1);
    setError(null);
    setSaved(null);
    // type, location, contractorId, selectedApprovers, coRequesterIds,
    // activityHead, approverCaps stay set — the supervisor keeps the
    // approval routing across the run.
  }

  if (saved) {
    return (
      <SaveSuccessCard
        title="Permit raised"
        detail={`${saved.title} — approvers notified.`}
        projectId={projectId}
        onAddAnother={resetForm}
        addAnotherSublabel="Fresh permit, blank fields"
        contextAction={{
          label: `Log another ${WORK_PERMIT_TYPE_LABELS[type]} permit`,
          sublabel: "Keeps the type, location, contractor, and approvers",
          onSelect: resetForNextOfSameType,
        }}
        queued={saved.queued}
      />
    );
  }

  const inputCls =
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] focus:outline-none focus:border-ink";

  const stepNames = ["Basic Info", "People", "Checklist", "Review"] as const;

  // Colab-parity step-1 gate: Permit Date + Valid From-To are required
  // before Continue enables. Step-2 gate: contractor + ≥1 approver.
  // Step 3 (checklist) is always available. Step 4 (Review) doesn't
  // block on anything, since it's the summary + submit stop.
  // Night Work permits deliberately cross midnight — "22:00 → 02:00" is
  // a normal slab-pour shift. isValidPermitTimeWindow relaxes the check
  // for that type; every other permit stays same-day.
  const timeOkForStep1 = isValidPermitTimeWindow(type, startTime, endTime);
  const canAdvance =
    step === 1
      ? title.trim().length >= 3 && workDate.length > 0 && timeOkForStep1
      : step === 2
        ? contractorId.length > 0 && selectedApprovers.size > 0
        : true;

  function goBack() {
    if (step === 1) {
      // Same as X close — bounce home. Handled by the layout's back
      // button in practice; here we just no-op.
      return;
    }
    setStep((s) => Math.max(1, (s as number) - 1) as 1 | 2 | 3 | 4);
    setError(null);
  }
  function goNext() {
    if (step === 4) return;
    setStep((s) => Math.min(4, (s as number) + 1) as 1 | 2 | 3 | 4);
    setError(null);
  }

  return (
    <form onSubmit={handleSubmit} className="pb-32">
      {/* Colab-parity wizard chrome: X close top-left, uppercase permit
          type title, "Step N of 4 — [step name]" subtitle, and a
          4-segment progress bar. Matches Abhishek zip screens 7/10/14/32. */}
      <div className="px-5 pt-5 pb-3 bg-ivory border-b border-sandstone-100">
        <div className="flex items-start gap-3">
          <button
            type="button"
            aria-label="Close permit wizard"
            onClick={(e) => {
              // Colab-parity: warn before discarding a partially-entered
              // permit. `dirty` counts any field the user has meaningfully
              // touched — a blank close from a fresh open exits silently.
              const dirty =
                title.trim().length > 0 ||
                description.trim().length > 0 ||
                location.trim().length > 0 ||
                contractorId.length > 0 ||
                selectedApprovers.size > 0 ||
                labourEntries.some((l) => l.workerName || l.role || l.count) ||
                personnelEntries.some((l) => l.workerName || l.role) ||
                coRequesterIds.size > 0 ||
                activityHead.length > 0 ||
                photos.length > 0 ||
                activeChecklist.some((a) => a.passed !== null || a.remark.trim() || a.photoUrl);
              if (dirty && !window.confirm("Discard this permit? Your entered details won't be saved.")) {
                e.preventDefault();
                return;
              }
              window.location.href = `/mobile/${projectId}`;
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sandstone-100 shrink-0"
          >
            <span className="text-xl">×</span>
          </button>
          <div className="flex-1 text-center">
            <h1 className="font-serif text-[20px] leading-tight text-ink tracking-tight uppercase">
              {WORK_PERMIT_TYPE_LABELS[type]} Permit
            </h1>
            <p className="text-[12px] text-ink-3 mt-0.5">
              Step {step} of 4 — {stepNames[step - 1]}
            </p>
          </div>
          <span className="w-9 shrink-0" aria-hidden />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1 rounded-full ${
                n <= step ? "bg-ink" : "bg-sandstone-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="px-5 py-5 space-y-5">
      {step === 1 && (
        <HowThisWorks
          title="How to request a work permit"
          storageKey="siddhi.htw.permit"
          steps={[
            "Pick the permit type — Hot Work, Night Work, De-shuttering, General, or Work At Height.",
            "Give it a short title so approvers can tell what it's for at a glance (e.g. \"Rebar welding on V12 slab\").",
            "Set the permit date, plus valid-from and valid-to times.",
            "Step 2: pick the contractor, add labour entries, and pick approver(s) with their Can Close / Can Suspend capabilities.",
            "Step 3: work your way through the safety checklist. Each row = Yes/No + optional remark + optional photo.",
            "Step 4: review everything and submit. Approver(s) get a push and can approve, reject, or suspend from their phone.",
          ]}
        />
      )}

      {/* Type — segmented picker so all four fit on-screen without scrolling */}
      <div className={step === 1 ? "" : "hidden"}>
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

      <label className={`block ${step === 1 ? "" : "hidden"}`}>
        <FieldLabel>Short title</FieldLabel>
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Welding of column reinforcement — Villa 14"
          maxLength={200}
        />
      </label>

      <label className={`block ${step === 1 ? "" : "hidden"}`}>
        <FieldLabel optional>Description</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[80px]`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Extra context for the approver."
          maxLength={2000}
        />
      </label>

      {/* Colab-parity CHECKPOINTS section — per-template safety
          checklist. Rows come from WORK_PERMIT_CHECKPOINTS keyed by
          the selected type; changing the type switches the visible
          question set. Each row = question · Yes/No toggle · optional
          remark. Answers ride the payload as checklistResponses. */}
      {activeChecklist.length > 0 && (
        <div className={`rounded-lg border border-stone-200 bg-white overflow-hidden ${step === 3 ? "" : "hidden"}`}>
          <div className="bg-ink text-white px-3 py-2 text-xs font-semibold uppercase tracking-wider flex items-center justify-between gap-2">
            <span>Checkpoints — {WORK_PERMIT_TYPE_LABELS[type]}</span>
            <span className="text-white/70 tabular-nums normal-case tracking-normal">
              {activeChecklist.filter((a) => a.passed !== null).length} / {activeChecklist.length} answered
            </span>
          </div>
          <ul className="divide-y divide-stone-100">
            {WORK_PERMIT_CHECKPOINTS[type].map((question, idx) => {
              const answer = activeChecklist[idx];
              return (
                <li key={idx} className="px-3 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <p className="flex-1 text-sm text-ink leading-snug">
                      {question}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setChecklistAnswer(idx, {
                          passed: answer.passed === true ? null : true,
                        })
                      }
                      className={`px-3 py-1 rounded-md text-xs font-semibold ${
                        answer.passed === true
                          ? "bg-emerald-500 text-white"
                          : "bg-stone-100 text-stone-500"
                      }`}
                      aria-pressed={answer.passed === true}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setChecklistAnswer(idx, {
                          passed: answer.passed === false ? null : false,
                        })
                      }
                      className={`px-3 py-1 rounded-md text-xs font-semibold ${
                        answer.passed === false
                          ? "bg-red-500 text-white"
                          : "bg-stone-100 text-stone-500"
                      }`}
                      aria-pressed={answer.passed === false}
                    >
                      No
                    </button>
                  </div>
                  <textarea
                    value={answer.remark}
                    onChange={(e) =>
                      setChecklistAnswer(idx, { remark: e.target.value })
                    }
                    placeholder="Add Remark (optional)"
                    rows={2}
                    className="w-full rounded-md border-2 border-dashed border-amber-300 bg-white px-2 py-1.5 text-sm resize-none"
                  />
                  {/* Colab-parity per-checkpoint photo attach — camera
                      icon inline with the remark, thumb + × when set. */}
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white text-[11px] font-semibold text-stone-700 px-2 py-1 cursor-pointer hover:bg-sandstone-50">
                      {uploadingCheckpointIdx === idx ? "Uploading…" : "📷 Attach photo"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingCheckpointIdx === idx}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadCheckpointPhoto(idx, f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {answer.photoUrl && (
                      <div className="flex items-center gap-1">
                        <a
                          href={answer.photoUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-block w-10 h-10 rounded overflow-hidden border border-stone-200 bg-stone-50"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={answer.photoUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </a>
                        <button
                          type="button"
                          onClick={() => setChecklistAnswer(idx, { photoUrl: "" })}
                          aria-label="Remove photo"
                          className="text-stone-400 hover:text-stone-600 text-xs"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Photos — step 3 (Checklist / evidence step). */}
      <div className={step === 3 ? "" : "hidden"}>
        <FieldLabel hint="A photo tells the approver the story faster than words." optional>
          Photos (up to 6)
        </FieldLabel>
        <PhotoPicker photos={photos} setPhotos={setPhotos} max={6} />
      </div>

      <div className={`grid grid-cols-3 gap-2 ${step === 1 ? "" : "hidden"}`}>
        <label className="block">
          <FieldLabel>Permit Date</FieldLabel>
          <input
            type="date"
            className={inputCls}
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </label>
        <label className="block">
          <FieldLabel>Valid From</FieldLabel>
          <input
            type="time"
            className={inputCls}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="block">
          <FieldLabel>Valid To</FieldLabel>
          <input
            type="time"
            className={inputCls}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
      </div>

      <label className={`block ${step === 1 ? "" : "hidden"}`}>
        <FieldLabel optional>Location</FieldLabel>
        <input
          className={inputCls}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Villa 14 · Ground floor · Column bay 3"
          maxLength={200}
        />
      </label>

      {/* Step 1: Activity Head (Colab's Step-1 dropdown). Free-text
          for now — a picker with the seeded activity heads is Phase 2
          work marked in phase2_exclusions_log if it applies. */}
      <label className={`block ${step === 1 ? "" : "hidden"}`}>
        <FieldLabel optional>Activity Head</FieldLabel>
        <input
          className={inputCls}
          value={activityHead}
          onChange={(e) => setActivityHead(e.target.value)}
          placeholder="e.g. Reinforcement · Shuttering · Surface Finishing"
          maxLength={120}
          list="permit-activity-head-suggestions"
        />
        {/* Colab-parity: free-text field with autocomplete hints for the
            common activity heads at Amanvana. The site team can still
            type anything else; datalist just speeds up the 80% case. */}
        <datalist id="permit-activity-head-suggestions">
          <option value="Reinforcement" />
          <option value="Shuttering" />
          <option value="Concrete Pour" />
          <option value="Masonry" />
          <option value="Plastering" />
          <option value="Painting" />
          <option value="Waterproofing" />
          <option value="Flooring" />
          <option value="Electrical" />
          <option value="Plumbing" />
          <option value="Surface Finishing" />
          <option value="Excavation" />
          <option value="Anti-Termite" />
          <option value="PCC" />
          <option value="Hacking" />
        </datalist>
      </label>

      {/* Step 2: Contractor. Colab requires it — enforced client-side
          in canAdvance. */}
      <label className={`block ${step === 2 ? "" : "hidden"}`}>
        <FieldLabel>Contractor <span className="text-red-500">*</span></FieldLabel>
        <select
          className={inputCls}
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
        >
          <option value="">Choose Contractor</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.category})
            </option>
          ))}
        </select>
      </label>

      {/* Step 2: Labour Entries (Colab's "+ Add Labour Entry"). */}
      <div className={step === 2 ? "" : "hidden"}>
        <FieldLabel hint="Workers involved in this permit" optional>
          Labour
        </FieldLabel>
        <div className="space-y-2">
          {labourEntries.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
              <input
                className={inputCls}
                value={row.workerName}
                onChange={(e) => {
                  const next = labourEntries.slice();
                  next[idx] = { ...next[idx], workerName: e.target.value };
                  setLabourEntries(next);
                }}
                placeholder="Worker name"
                maxLength={120}
              />
              <input
                className={inputCls}
                value={row.role}
                onChange={(e) => {
                  const next = labourEntries.slice();
                  next[idx] = { ...next[idx], role: e.target.value };
                  setLabourEntries(next);
                }}
                placeholder="Role (Welder, Rigger…)"
                maxLength={80}
              />
              <input
                className={`${inputCls} w-16`}
                value={row.count}
                onChange={(e) => {
                  const next = labourEntries.slice();
                  next[idx] = { ...next[idx], count: e.target.value.replace(/[^0-9]/g, "") };
                  setLabourEntries(next);
                }}
                placeholder="#"
                maxLength={4}
              />
              <button
                type="button"
                onClick={() =>
                  setLabourEntries(labourEntries.filter((_, i) => i !== idx))
                }
                aria-label="Remove labour row"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setLabourEntries([
                ...labourEntries,
                { workerName: "", role: "", count: "" },
              ])
            }
            className="w-full rounded-lg border border-ink text-ink text-sm font-semibold py-2 hover:bg-sandstone-50"
          >
            + Add Labour Entry
          </button>
        </div>
      </div>

      {/* Step 2: Colab-parity "Details of Personnel in Attendance"
          (Night Work permit only, Abhishek zip). Same row shape as
          Labour but the semantic is named supervisors / safety officers
          on site during night hours — the placeholder text calls this
          out. Hidden when type != NIGHT_WORK; state is preserved when
          the user switches type mid-form so an accidental type toggle
          doesn't nuke the list. */}
      <div className={step === 2 && type === "NIGHT_WORK" ? "" : "hidden"}>
        <FieldLabel hint="Named supervisors / safety officers on site" optional>
          Details of Personnel in Attendance
        </FieldLabel>
        <div className="space-y-2">
          {personnelEntries.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input
                className={inputCls}
                value={row.workerName}
                onChange={(e) => {
                  const next = personnelEntries.slice();
                  next[idx] = { ...next[idx], workerName: e.target.value };
                  setPersonnelEntries(next);
                }}
                placeholder="Name"
                maxLength={120}
              />
              <input
                className={inputCls}
                value={row.role}
                onChange={(e) => {
                  const next = personnelEntries.slice();
                  next[idx] = { ...next[idx], role: e.target.value };
                  setPersonnelEntries(next);
                }}
                placeholder="Designation (Site Supervisor…)"
                maxLength={80}
              />
              <button
                type="button"
                onClick={() =>
                  setPersonnelEntries(personnelEntries.filter((_, i) => i !== idx))
                }
                aria-label="Remove personnel row"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setPersonnelEntries([
                ...personnelEntries,
                { workerName: "", role: "", count: "1" },
              ])
            }
            className="w-full rounded-lg border border-ink text-ink text-sm font-semibold py-2 hover:bg-sandstone-50"
          >
            + Add Person in Attendance
          </button>
        </div>
      </div>

      {/* Step 2: Co-Requesters — additional permit holders. */}
      <div className={step === 2 ? "" : "hidden"}>
        <FieldLabel hint="Additional permit holders" optional>
          Co-Requesters
        </FieldLabel>
        <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-sandstone-100 bg-cream p-2">
          {approverOptions.map((u) => {
            const checked = coRequesterIds.has(u.id);
            return (
              <label
                key={u.id}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer ${checked ? "bg-sandstone-100" : "hover:bg-sandstone-50"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setCoRequesterIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(u.id)) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                  }
                  className="w-4 h-4 accent-ferrous-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] text-ink">{u.name}</div>
                  <div className="text-[11px] text-ink-3">@{u.username}</div>
                </div>
              </label>
            );
          })}
          {approverOptions.length === 0 && (
            <p className="text-[12px] text-ink-3 px-2 py-1.5">
              No candidates.
            </p>
          )}
        </div>
      </div>

      <div className={step === 2 ? "" : "hidden"}>
        <FieldLabel hint="At least one approver across all levels is required">
          Approval Levels — Level 1
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
                  {/* Colab-parity capability chips per approver.
                      Default Can Close = ON; Can Suspend = OFF. */}
                  {checked && (
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.preventDefault()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCap(u.id, {
                            canClose: !(approverCaps[u.id]?.canClose ?? true),
                          });
                        }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                          (approverCaps[u.id]?.canClose ?? true)
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-stone-100 text-stone-400 ring-stone-200"
                        }`}
                      >
                        🔒 Can Close
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCap(u.id, {
                            canSuspend: !(approverCaps[u.id]?.canSuspend ?? false),
                          });
                        }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                          (approverCaps[u.id]?.canSuspend ?? false)
                            ? "bg-amber-50 text-amber-800 ring-amber-200"
                            : "bg-stone-100 text-stone-400 ring-stone-200"
                        }`}
                      >
                        ⏸ Can Suspend
                      </button>
                    </div>
                  )}
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* Step 4 — Review Permit card. Everything the requester
          entered rendered as a read-only summary, plus an "Approver
          Capabilities" card showing per-level rows with Can Close / Can
          Suspend chips. Matches Abhishek zip screen 32 exactly. */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
            <p className="text-[13px] font-semibold text-ink mb-1">Review Permit</p>
            <ReviewRow label="Permit Type" value={WORK_PERMIT_TYPE_LABELS[type].toUpperCase()} />
            <ReviewRow label="Date" value={workDate ? new Date(workDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
            <ReviewRow label="Valid From – To" value={`${startTime} – ${endTime}`} />
            <ReviewRow label="Description" value={(description.trim() || WORK_PERMIT_TYPE_LABELS[type]).toUpperCase()} />
            <ReviewRow
              label="Contractor"
              value={contractors.find((c) => c.id === contractorId)?.name ?? "—"}
            />
            <ReviewRow
              label="Approval Levels"
              value={`${selectedApprovers.size > 0 ? 1 : 0} level · ${selectedApprovers.size} approver${selectedApprovers.size === 1 ? "" : "s"}`}
            />
            {/* Show the count that will ACTUALLY submit — empty rows
                (no name / role / count) are filtered on the payload
                clean step and shouldn't show up in the review. */}
            <ReviewRow
              label="Labour entries"
              value={
                (() => {
                  const n = labourEntries.filter(
                    (r) => r.workerName.trim() || r.role.trim() || r.count.trim(),
                  ).length;
                  return n === 0 ? "None" : String(n);
                })()
              }
            />
            {type === "NIGHT_WORK" && (
              <ReviewRow
                label="Personnel in Attendance"
                value={
                  (() => {
                    const n = personnelEntries.filter(
                      (r) => r.workerName.trim() || r.role.trim(),
                    ).length;
                    return n === 0 ? "None" : String(n);
                  })()
                }
              />
            )}
            <ReviewRow label="Activity Head" value={activityHead || "—"} />
            <ReviewRow label="Location" value={location || "—"} />
            <ReviewRow label="Images" value={photos.length === 0 ? "None" : String(photos.length)} />
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
            <p className="text-[13px] font-semibold text-ink">Approver Capabilities</p>
            <p className="text-[12px] text-ink-3 font-semibold">Level 1 — Level 1</p>
            {Array.from(selectedApprovers).map((uid) => {
              const u = approverOptions.find((a) => a.id === uid);
              if (!u) return null;
              const cap = approverCaps[uid] ?? { canClose: true, canSuspend: false };
              return (
                <div key={uid} className="flex items-center justify-between gap-3">
                  <div className="text-[13px] text-ink truncate">{u.name}</div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                        cap.canClose
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-stone-100 text-stone-400 ring-stone-200"
                      }`}
                    >
                      🔒 Can Close
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                        cap.canSuspend
                          ? "bg-amber-50 text-amber-800 ring-amber-200"
                          : "bg-stone-100 text-stone-400 ring-stone-200"
                      }`}
                    >
                      ⏸ Can Suspend
                    </span>
                  </div>
                </div>
              );
            })}
            {selectedApprovers.size === 0 && (
              <p className="text-[12px] text-red-600">
                No approver picked — go back to Step 2 and pick at least one.
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-[13px] text-ferrous-700 bg-ferrous-50 border border-ferrous-100 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      </div>

      {/* Colab-parity wizard footer — sticky bar at the bottom with
          Back on the left and Continue / Submit on the right. */}
      <div
        className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-ivory border-t border-sandstone-100 px-4 py-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {/* Hint text above the buttons explaining what's missing when
            Continue is disabled. Silent when the form is complete for
            the current step. */}
        {!canAdvance && step < 4 && (
          <p className="text-[11px] text-ferrous-600 mb-2 leading-snug">
            {step === 1
              ? title.trim().length < 3
                ? "Add a title (at least 3 characters) to continue."
                : !timeOkForStep1
                  ? type === "NIGHT_WORK"
                    ? "Start and end time can't be the same."
                    : "End time must be after start time."
                  : "Work date is required."
              : step === 2
                ? contractorId.length === 0
                  ? "Pick a contractor before continuing."
                  : "Add at least one approver before continuing."
                : ""}
          </p>
        )}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-xl border border-stone-300 bg-white text-ink text-sm font-semibold px-4 py-2 disabled:opacity-40"
          >
            ← Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-ink text-white text-sm font-semibold py-2 disabled:opacity-40"
            >
              → Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={pending || selectedApprovers.size === 0}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-2 disabled:opacity-40"
            >
              {pending ? "Submitting…" : "✓ Submit Permit"}
            </button>
          )}
        </div>
        {!isFullAccess && step === 4 && (
          <p className="text-[11px] text-ink-3 text-center mt-2">
            You&apos;ll get notified when an approver acts on this permit.
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Read-only key/value row for the Step 4 Review card. Two columns —
 * label on the left in muted stone, value on the right in bold ink.
 */
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 text-[13px]">
      <div className="text-stone-500">{label}</div>
      <div className="font-semibold text-ink">{value}</div>
    </div>
  );
}
