"use client";

import { useEffect, useMemo, useState } from "react";
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
 * One approval level inside the Step 2 picker. `levelIndex` is 1-based
 * and stays stable even when earlier levels are removed, so the server
 * stores the exact index the requester saw. `userIds` is the set of
 * approvers in that level; a user may appear in multiple levels (Colab
 * allows this; the server's (permit, user, levelIndex) unique index
 * deduplicates on insert).
 */
type ApproverLevel = { levelIndex: number; levelName: string; userIds: Set<string> };

/** Maximum approval levels supported — Colab parity. */
const MAX_APPROVER_LEVELS = 5;

/** Canonical labour roles for the Step 2 Labour section.
 *  Vandana 2026-10-15 post-walkthrough: safety team requested a fixed
 *  dropdown instead of free-text so the dataset is clean for reports.
 *  "Others" at the end flips the row into a free-text mode for the
 *  rare role that doesn't fit a preset (e.g. a specialist welder on a
 *  one-off Hot Work permit). */
const LABOUR_ROLES: readonly string[] = [
  "Masonry",
  "Masonry Helpers",
  "Scaffolders",
  "Scaffolder Helpers",
  "Fabricator",
  "Fabricator Helpers",
];

/** Canonical activity heads for the Select Activity Head bottom sheet.
 *  Mirrors the previous datalist contents + Colab's screenshot examples
 *  (Earthwork, Waterproofing). Sorted alphabetically for predictable
 *  scanning. The sheet also lets the user commit free-text so site
 *  teams aren't locked out of a less common head. */
const ACTIVITY_HEADS: readonly string[] = [
  "Anti-Termite",
  "Concrete Pour",
  "Earthwork",
  "Electrical",
  "Excavation",
  "Flooring",
  "Hacking",
  "Masonry",
  "Painting",
  "PCC",
  "Plastering",
  "Plumbing",
  "Reinforcement",
  "Shuttering",
  "Surface Finishing",
  "Waterproofing",
];

/** Count unique approvers across all levels (deduped). */
function totalUniqueApprovers(levels: ApproverLevel[]): number {
  const seen = new Set<string>();
  for (const l of levels) for (const u of l.userIds) seen.add(u);
  return seen.size;
}

/** Count levels that have at least one approver. */
function nonEmptyLevelCount(levels: ApproverLevel[]): number {
  return levels.filter((l) => l.userIds.size > 0).length;
}

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

  // Colab "Default" prefill · Vandana 2026-10-14 mid-walkthrough: for
  // EHS today Girish is the only canApproveWorkPermits user on the
  // project, and asking the raiser to tap through a bottom sheet to
  // pick him every time is friction with no choice. If there's exactly
  // one approver candidate AND the current Level 1 is empty, drop them
  // in automatically. Multi-approver projects (future QAQC, future
  // multiple HSE approvers) still see an empty picker and have to
  // choose explicitly, which is correct.
  useEffect(() => {
    if (approverOptions.length !== 1) return;
    setApproverLevels((prev) => {
      if (prev.length !== 1) return prev;
      if (prev[0].userIds.size !== 0) return prev;
      const only = approverOptions[0];
      return [{ ...prev[0], userIds: new Set([only.id]) }];
    });
  }, [approverOptions]);

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
  // Colab-parity Valid From / Valid To — endDate defaults to the same
  // day as workDate so a fresh permit reads as "single day" out of the
  // box. When the user bumps workDate forward, we auto-track endDate if
  // it's still on the old workDate — but stop tracking as soon as the
  // user picks their own endDate explicitly (a manual pick wins).
  const [endDate, setEndDate] = useState(() => istDayString());
  const [endDateTouched, setEndDateTouched] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [location, setLocation] = useState("");
  const [contractorId, setContractorId] = useState<string>("");
  // Approvers · 2026-10-12 (Vandana): widened from one flat Set to a
  // list of up to 5 approval levels (Colab parity, Abhishek 30 Sep
  // screenshots). Each level is independent and can hold multiple
  // approvers; the same user may appear in more than one level (Colab
  // allows this and the server dedupes on insert via the (permit,
  // user, levelIndex) unique index). Level 1 is mandatory and cannot
  // be removed; levels 2-5 are added on demand via a button. Approval
  // semantics on the API remain first-approver-wins across all levels
  // for now — proper sequential multi-level sign-off is a follow-up
  // (schema already supports it).
  const [approverLevels, setApproverLevels] = useState<ApproverLevel[]>([
    { levelIndex: 1, levelName: "", userIds: new Set() },
  ]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Colab-parity 4-step wizard state. Step numbers match the header
  // pattern "Step N of 4 — [name]". State stays flat across steps so
  // Back doesn't lose entered data.
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Guard against the iOS "ghost tap" where tapping Continue on Step 3
  // flips the sticky-footer slot to Submit, and a lingering synthetic
  // click lands on the newly-rendered Submit button — the permit then
  // "submits by itself" without the raiser ever reading the Review
  // card. Fix (Vandana 2026-10-15 post-walkthrough): keep Submit
  // disabled for 600 ms after Step 4 renders, so by the time it's
  // clickable the pointer sequence from the Continue tap is done.
  const [submitReady, setSubmitReady] = useState(false);
  useEffect(() => {
    if (step !== 4) {
      setSubmitReady(false);
      return;
    }
    const t = setTimeout(() => setSubmitReady(true), 600);
    return () => clearTimeout(t);
  }, [step]);

  // Colab-parity Step 2 additions.
  //
  // Vandana 2026-10-15: Labour row shape was reduced to Role + # Workers
  // for permits (Worker Name UI dropped). workerName stays on the type
  // for compatibility with the Night Work "Personnel in Attendance"
  // section which still uses the same row interface; for permit labour
  // it always ships empty.
  //
  // `othersMode` is a per-row UI flag: true when the raiser picked the
  // "Others" option in the role dropdown, which reveals a text input
  // and lets them type a custom role. We keep it on the row state so
  // the input stays revealed after the raiser types; deriving from
  // role alone would lose the state while the field is empty.
  type LabourEntry = { workerName: string; role: string; count: string; othersMode?: boolean };
  const [labourEntries, setLabourEntries] = useState<LabourEntry[]>([]);

  // A labour row counts as "filled" when it has both a non-empty role
  // and a positive worker count. Used to gate Step 2 Continue (at
  // least one filled row required) and to filter rows at submit.
  function isLabourRowFilled(r: LabourEntry): boolean {
    const count = Number(r.count);
    return r.role.trim().length > 0 && Number.isFinite(count) && count > 0;
  }
  // Colab-parity approver bottom sheet · 2026-10-13 (Vandana): "Select
  // Approver — Level N" (video frame 20). Opens on tap of "Add
  // Approver to Level N"; closes on tap-outside or Done. Already-picked
  // approvers in that level show a grayed green ✓ and stay unclickable;
  // the rest show a + icon.
  const [approverSheetPos, setApproverSheetPos] = useState<number | null>(null);
  const [approverSearch, setApproverSearch] = useState("");
  // Activity head picker (bottom sheet) · Colab-parity, Vandana
  // 2026-10-14 mid-walkthrough. Keeps the activityHead state as a
  // simple string; sheet just offers a search-filtered list of common
  // heads with a "Use custom text" fallback.
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");
  // Colab-parity: Night Work permit has a dedicated "Details of
  // Personnel in Attendance" section (Abhishek zip). Same row shape as
  // labour but the semantic is named supervisors / safety officers on
  // site during night hours. Kept as a separate state slice so the two
  // lists render as two distinct cards; the API `kind` field splits
  // them on write.
  const [personnelEntries, setPersonnelEntries] = useState<LabourEntry[]>([]);
  const [activityHead, setActivityHead] = useState<string>("");
  // Approver capabilities used to be picked per-row (Can Close / Can
  // Suspend chips). Shraddha 2026-09-30: the requester shouldn't be
  // choosing what an approver can do — Girish (head of safety) has
  // everything by default. The chips are gone from Step 2; every
  // selected approver is sent with both capabilities on.
  // After save: in-place success card (Add another / Back to home) so
  // engineers raising back-to-back permits don't get bounced home each time.
  const [saved, setSaved] = useState<null | { queued: boolean; title: string }>(null);

  function toggleApprover(levelPos: number, id: string) {
    setApproverLevels((prev) =>
      prev.map((l, i) => {
        if (i !== levelPos) return l;
        const next = new Set(l.userIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...l, userIds: next };
      }),
    );
  }

  /** Append a new empty approval level, up to MAX_APPROVER_LEVELS. */
  function addApprovalLevel() {
    setApproverLevels((prev) => {
      if (prev.length >= MAX_APPROVER_LEVELS) return prev;
      const nextIndex = Math.max(...prev.map((l) => l.levelIndex), 0) + 1;
      return [...prev, { levelIndex: nextIndex, levelName: "", userIds: new Set() }];
    });
  }

  /** Remove the level at this UI position. Level at position 0 is
   *  mandatory (first-approver-wins at least needs one), so refuse. */
  function removeApprovalLevel(levelPos: number) {
    setApproverLevels((prev) => {
      if (prev.length <= 1 || levelPos === 0) return prev;
      return prev.filter((_, i) => i !== levelPos);
    });
  }

  /** Rename a level. Empty name is allowed; server fills in "Level N"
   *  on submit so the rendered label never reads just the number. */
  function renameApprovalLevel(levelPos: number, name: string) {
    setApproverLevels((prev) =>
      prev.map((l, i) => (i === levelPos ? { ...l, levelName: name } : l)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return; // guard against a fast double-tap on Submit Permit
    setError(null);
    if (title.trim().length < 3) {
      setError("Give the permit a short title (3+ characters).");
      return;
    }
    if (totalUniqueApprovers(approverLevels) === 0) {
      setError("Pick at least one approver.");
      return;
    }
    if (endDate && endDate < workDate) {
      setError("Valid To date can't be earlier than Valid From date.");
      return;
    }
    // Time-window check only bites for SAME-DAY permits. When the
    // permit spans multiple days (workDate < endDate), any start/end
    // time combination is valid because the real end (endDate + endTime)
    // is always after the real start (workDate + startTime).
    const singleDay = !endDate || endDate === workDate;
    if (singleDay && !isValidPermitTimeWindow(type, startTime, endTime)) {
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
    // - activityHead (Colab's Activity Head dropdown pick)
    // - approvers[] — every picked approver gets both capabilities
    //   (canClose + canSuspend); the requester no longer chooses.
    //   The existing approverIds[] payload key stays for the current
    //   API contract; approvers[] rides alongside so the new endpoint
    //   can persist capabilities.
    // Permit labour rows (Vandana 2026-10-15) ship with role + count
    // only — Worker Name was dropped from the UI. Rows that aren't
    // fully filled are discarded, which can't actually happen because
    // Step 2 Continue blocks on labourFilledCount, but the server
    // should also reject malformed rows if a stale client ever posts
    // one. workerName stays on the row interface because Night Work's
    // "Personnel in Attendance" (cleanAttendance below) still uses it.
    const cleanLabour = labourEntries
      .filter(isLabourRowFilled)
      .map((r) => ({
        kind: "LABOUR" as const,
        workerName: undefined,
        role: r.role.trim(),
        count: Number(r.count),
      }));

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

    // Build per-level approver rows for the server. Each selected
    // user at a level becomes one PermitApprover row with that level's
    // real levelIndex. The capability chips are intentionally skipped
    // (Shraddha 2026-09-30 rule): every picked approver gets both
    // canClose + canSuspend. The top-level approverIds array is the
    // deduped union of all level members so the first-approver-wins
    // code path keeps working unchanged.
    const approversWithCaps = approverLevels.flatMap((lvl) =>
      Array.from(lvl.userIds).map((userId) => ({
        userId,
        levelIndex: lvl.levelIndex,
        // Colab-parity: a level can carry a human name ("Site", "safety")
        // alongside the index, so the approver detail page can render
        // "Site (Level 1)" instead of just "Level 1". Fall back to the
        // generic "Level N" when the raiser leaves the name blank.
        levelName: lvl.levelName.trim() || `Level ${lvl.levelIndex}`,
        canClose: true,
        canSuspend: true,
      })),
    );
    const approverIdsArr = Array.from(new Set(approversWithCaps.map((a) => a.userId)));

    const payload = {
      idempotencyKey: crypto.randomUUID(),
      projectId,
      type,
      title: title.trim(),
      description: description.trim() || undefined,
      workDate,
      // Only send endDate when it's a real multi-day permit — for
      // same-day the server defaults to workDate anyway, so we keep
      // the payload smaller and legacy clients that never carried
      // endDate stay identical on the wire.
      endDate: endDate && endDate !== workDate ? endDate : undefined,
      startTime,
      endTime,
      location: location.trim() || undefined,
      contractorId: contractorId || undefined,
      approverIds: approverIdsArr,
      approvers: approversWithCaps,
      labourEntries: combinedLabour.length > 0 ? combinedLabour : undefined,
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
    setEndDate(istDayString());
    setEndDateTouched(false);
    setStartTime("09:00");
    setEndTime("18:00");
    setLocation("");
    setContractorId("");
    setApproverLevels([{ levelIndex: 1, levelName: "", userIds: new Set() }]);
    setPhotos([]);
    // Step 2 collections must reset too on a hard "Add another" —
    // otherwise labour entries, personnel, activity head, and
    // per-checkpoint answers from the just-saved permit would silently
    // carry into the next one.
    setLabourEntries([]);
    setPersonnelEntries([]);
    setActivityHead("");
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
    setEndDate(istDayString());
    setEndDateTouched(false);
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
    // type, location, contractorId, approverLevels, activityHead
    // stay set — the supervisor keeps the approval routing across
    // the run.
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
  //
  // For a multi-day permit (endDate > workDate) any time combination is
  // valid because the real end (endDate + endTime) always follows the
  // real start (workDate + startTime). Only same-day permits need the
  // strict time-window check.
  const singleDayPermit = !endDate || endDate === workDate;
  const timeOkForStep1 = singleDayPermit
    ? isValidPermitTimeWindow(type, startTime, endTime)
    : true;
  const dateOkForStep1 =
    workDate.length > 0 && (!endDate || endDate >= workDate);
  // Step 3 (Checklist) gate · Vandana 2026-10-14 mid-walkthrough:
  // every checkpoint on an active HSE checklist MUST be answered
  // (Yes or No — matches Colab's binary toggle per video frame 30)
  // before the raiser can move to Review. A permit the raiser clicked
  // through without reading its own safety checklist is the opposite
  // of what the module exists for.
  const checklistAllAnswered =
    activeChecklist.length === 0 ||
    activeChecklist.every((a) => a.passed !== null);
  // Step 2 now also requires at least one filled Labour row — Vandana
  // 2026-10-15: Role + # Workers are mandatory per permit, so an empty
  // Labour section blocks Continue.
  const labourFilledCount = labourEntries.filter(isLabourRowFilled).length;
  const canAdvance =
    step === 1
      ? title.trim().length >= 3 && dateOkForStep1 && timeOkForStep1
      : step === 2
        ? contractorId.length > 0 &&
          totalUniqueApprovers(approverLevels) > 0 &&
          labourFilledCount > 0
        : step === 3
          ? checklistAllAnswered
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
                totalUniqueApprovers(approverLevels) > 0 ||
                labourEntries.some((l) => l.workerName || l.role || l.count) ||
                personnelEntries.some((l) => l.workerName || l.role) ||
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
            "Step 2: pick the contractor, add labour entries, and pick the approver.",
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
                        // Permits are camera-only (Vandana 2026-10-15
                        // post-walkthrough). Checkpoint evidence should
                        // be shot on the spot, not pulled from a
                        // pre-existing album — defeats the point of a
                        // safety verification photo.
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
        <PhotoPicker photos={photos} setPhotos={setPhotos} max={6} cameraOnly />
      </div>

      {/* Permit Date on top, Valid From (time) + Valid To (time) in the
          row beneath. Vandana 2026-10-14: collapsed to a single-day
          permit model to match Colab exactly (video + screenshot
          reference). No end-date input — permits are for ONE day
          between the two times. The underlying endDate state is kept
          and set equal to workDate on every workDate change so the
          submit payload still carries both for API compatibility
          (server accepts endDate as nullable; passing it equal to
          workDate keeps single-day queries correct). */}
      <div className={`space-y-2 ${step === 1 ? "" : "hidden"}`}>
        <label className="block">
          <FieldLabel>Permit Date</FieldLabel>
          <input
            type="date"
            className={inputCls}
            value={workDate}
            onChange={(e) => {
              const next = e.target.value;
              setWorkDate(next);
              // Keep endDate pinned to workDate — single-day only now.
              setEndDate(next);
            }}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
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

      {/* Step 1: Select Activity Head · Colab-parity bottom-sheet picker
          with a search field (video frame 11, mid-walkthrough feedback
          Oct 14). Replaces the previous free-text input with datalist
          hints. Underlying model still a string, so no payload change. */}
      <div className={`block ${step === 1 ? "" : "hidden"}`}>
        <FieldLabel optional>Select Activity Head</FieldLabel>
        <button
          type="button"
          onClick={() => {
            setActivityPickerOpen(true);
            setActivitySearch("");
          }}
          className={`${inputCls} text-left flex items-center justify-between`}
        >
          <span className={activityHead ? "text-ink" : "text-ink-4"}>
            {activityHead || "Choose Activity Head"}
          </span>
          <span className="text-ink-4 ml-2">▾</span>
        </button>
      </div>

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

      {/* Step 2: Labour Entries. Vandana 2026-10-15 post-walkthrough:
          per row = Role (dropdown, 6 presets + Others→free text) and
          # Workers. Both mandatory to count the row as filled; Step 2
          Continue blocks until at least one row is filled. Worker Name
          input removed per the safety team's ask; the role dropdown
          keeps the dataset clean for reports. */}
      <div className={step === 2 ? "" : "hidden"}>
        <FieldLabel hint="Role + number of workers for each team on this permit">
          Labour <span className="text-red-500">*</span>
        </FieldLabel>
        <div className="space-y-2">
          {labourEntries.map((row, idx) => {
            const updateRow = (patch: Partial<LabourEntry>) => {
              const next = labourEntries.slice();
              next[idx] = { ...next[idx], ...patch };
              setLabourEntries(next);
            };
            // Dropdown value: preset name if role matches a preset,
            // "__OTHERS__" sentinel if othersMode is on (even with
            // empty custom text), empty string otherwise. Legacy rows
            // where role is a non-preset string also render as Others.
            const isPreset = LABOUR_ROLES.includes(row.role);
            const selectValue = row.othersMode || (!isPreset && row.role.length > 0)
              ? "__OTHERS__"
              : row.role;
            const showCustomInput = selectValue === "__OTHERS__";
            return (
              <div key={idx} className="rounded-lg border border-sandstone-100 bg-cream p-2 space-y-2">
                <div className="grid grid-cols-[1fr_72px_auto] gap-2 items-center">
                  <select
                    className={inputCls}
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__OTHERS__") {
                        // Keep any existing custom text if the user
                        // flips back to Others after a brief detour.
                        updateRow({
                          role: isPreset ? "" : row.role,
                          othersMode: true,
                        });
                      } else {
                        updateRow({ role: v, othersMode: false });
                      }
                    }}
                  >
                    <option value="">Choose role…</option>
                    {LABOUR_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="__OTHERS__">Others</option>
                  </select>
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={row.count}
                    onChange={(e) =>
                      updateRow({ count: e.target.value.replace(/[^0-9]/g, "") })
                    }
                    placeholder="# workers"
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
                {showCustomInput && (
                  <input
                    className={inputCls}
                    value={row.role}
                    onChange={(e) => updateRow({ role: e.target.value })}
                    placeholder="Type the role"
                    maxLength={80}
                    autoFocus
                  />
                )}
              </div>
            );
          })}
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
            + Add Labour Row
          </button>
          {labourFilledCount === 0 && labourEntries.length > 0 && (
            <p className="text-[11px] text-ferrous-600 px-1 italic">
              Fill role and worker count on at least one row.
            </p>
          )}
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

      {/* Co-Requesters used to sit here as an "Additional permit holders"
          multi-picker. Removed 2026-09-30: Shraddha asked for a lighter
          Step 2 — the requester is whoever raised the permit; no second
          holder is picked. If we need multi-holder support later we
          bring the block back. */}

      <div className={step === 2 ? "space-y-3" : "hidden"}>
        {/* Simplified "Approver" block · Vandana 2026-10-14 mid-walkthrough:
            dropped the level 1 / level 2 / level N multi-level machinery
            for now ("when the team grows, we can add these"). Shipped
            today's permits route to a single approver (Girish). The
            data model still writes levelIndex=1 so when multi-level
            comes back it's a UI change, not a schema one. All code
            still references approverLevels[0] under the hood. */}
        <FieldLabel hint="Pick who signs off this permit">
          Approver
        </FieldLabel>
        {approverLevels.slice(0, 1).map((lvl, pos) => (
          <div
            key={lvl.levelIndex}
            className="rounded-lg border border-sandstone-100 bg-cream p-2 space-y-1.5"
          >
            {lvl.userIds.size === 0 ? (
              <p className="text-[12px] text-ink-3 px-2 py-1 italic">
                No approver picked yet.
              </p>
            ) : (
              Array.from(lvl.userIds).map((uid) => {
                const u = approverOptions.find((a) => a.id === uid);
                if (!u) return null;
                return (
                  <div
                    key={uid}
                    className="flex items-center gap-2 rounded-md bg-white border border-sandstone-200 px-2.5 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-ink leading-tight">{u.name}</div>
                      <div className="text-[11px] text-ink-3">
                        Default · {u.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleApprover(pos, uid)}
                      className="text-ink-3 hover:text-ferrous-600 text-sm px-2 py-0.5"
                      aria-label={`Remove ${u.name}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
            <button
              type="button"
              onClick={() => {
                setApproverSheetPos(pos);
                setApproverSearch("");
              }}
              disabled={approverOptions.length === 0}
              className="w-full rounded-md border border-dashed border-ink text-ink text-sm font-semibold py-2 hover:bg-sandstone-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add Approver
            </button>
            {approverOptions.length === 0 && (
              <p className="text-[11px] text-ink-3 px-1 italic">
                No approvers available. Ask an admin to provision an internal user.
              </p>
            )}
          </div>
        ))}
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
            <ReviewRow
              label="Dates"
              value={(() => {
                if (!workDate) return "—";
                const fmt = (v: string) =>
                  new Date(v).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  });
                const start = fmt(workDate);
                if (!endDate || endDate === workDate) return start;
                return `${start} – ${fmt(endDate)}`;
              })()}
            />
            <ReviewRow label="Times" value={`${startTime} – ${endTime}`} />
            <ReviewRow label="Description" value={(description.trim() || WORK_PERMIT_TYPE_LABELS[type]).toUpperCase()} />
            <ReviewRow
              label="Contractor"
              value={contractors.find((c) => c.id === contractorId)?.name ?? "—"}
            />
            <ReviewRow
              label="Approval Levels"
              value={(() => {
                const nL = nonEmptyLevelCount(approverLevels);
                const nA = totalUniqueApprovers(approverLevels);
                return `${nL} level${nL === 1 ? "" : "s"} · ${nA} approver${nA === 1 ? "" : "s"}`;
              })()}
            />
            {/* Show the count + worker total that will ACTUALLY submit
                — half-filled rows are discarded on the payload clean
                step and shouldn't show up in the review. */}
            <ReviewRow
              label="Labour"
              value={
                (() => {
                  const filled = labourEntries.filter(isLabourRowFilled);
                  if (filled.length === 0) return "None";
                  const workers = filled.reduce((sum, r) => sum + Number(r.count), 0);
                  const rowWord = filled.length === 1 ? "row" : "rows";
                  const workerWord = workers === 1 ? "worker" : "workers";
                  return `${filled.length} ${rowWord} · ${workers} ${workerWord}`;
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

          <div className="rounded-lg border border-stone-200 bg-white p-4 space-y-3">
            <p className="text-[13px] font-semibold text-ink">Approvers</p>
            {approverLevels
              .filter((l) => l.userIds.size > 0)
              .map((l) => (
                <div key={l.levelIndex}>
                  <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider mb-1">
                    Level {l.levelIndex}
                    {l.levelName.trim() ? ` — ${l.levelName.trim()}` : ""}
                  </div>
                  {Array.from(l.userIds).map((uid) => {
                    const u = approverOptions.find((a) => a.id === uid);
                    if (!u) return null;
                    return (
                      <div key={uid} className="text-[13px] text-ink">
                        {u.name}
                      </div>
                    );
                  })}
                </div>
              ))}
            {totalUniqueApprovers(approverLevels) === 0 && (
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
          Back on the left and Continue / Submit on the right.
          Positioned ABOVE the mobile layout's tab bar (56 px tall + iOS
          safe-area) so it doesn't get painted under the persistent bottom
          nav. z-30 keeps it above ordinary scrolling content but below
          modals + bottom sheets, which use z-40 / z-50. */}
      <div
        className="fixed inset-x-0 max-w-md mx-auto bg-ivory border-t border-sandstone-100 px-4 py-3 z-30"
        style={{ bottom: "calc(56px + env(safe-area-inset-bottom))" }}
      >
        {/* Hint text above the buttons explaining what's missing when
            Continue is disabled. Silent when the form is complete for
            the current step. */}
        {!canAdvance && step < 4 && (
          <p className="text-[11px] text-ferrous-600 mb-2 leading-snug">
            {step === 1
              ? title.trim().length < 3
                ? "Add a title (at least 3 characters) to continue."
                : !dateOkForStep1
                  ? workDate.length === 0
                    ? "Valid From date is required."
                    : "Valid To date can't be earlier than Valid From date."
                  : !timeOkForStep1
                    ? type === "NIGHT_WORK"
                      ? "Start and end time can't be the same."
                      : "End time must be after start time."
                    : "Valid From date is required."
              : step === 2
                ? contractorId.length === 0
                  ? "Pick a contractor before continuing."
                  : totalUniqueApprovers(approverLevels) === 0
                    ? "Add at least one approver before continuing."
                    : "Add at least one labour row (role + # workers) before continuing."
                : step === 3
                  ? `Answer all ${activeChecklist.length} checkpoints (Yes / No) before continuing — ${activeChecklist.filter((a) => a.passed !== null).length} answered so far.`
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
              key="permit-wizard-continue"
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-ink text-white text-sm font-semibold py-2 disabled:opacity-40"
            >
              → Continue
            </button>
          ) : (
            // Distinct key from Continue so React tears down the old
            // button and mounts a fresh one — belt-and-braces with
            // submitReady to shut down the Step 3 → Step 4 ghost tap.
            <button
              key="permit-wizard-submit"
              type="submit"
              disabled={!submitReady || pending || totalUniqueApprovers(approverLevels) === 0}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-2 disabled:opacity-40"
            >
              {pending ? "Submitting…" : submitReady ? "✓ Submit Permit" : "Review the summary…"}
            </button>
          )}
        </div>
        {!isFullAccess && step === 4 && (
          <p className="text-[11px] text-ink-3 text-center mt-2">
            You&apos;ll get notified when an approver acts on this permit.
          </p>
        )}
      </div>

      {/* Colab-parity approver bottom sheet · opens when the raiser
          taps "+ Add Approver to Level N" (video frame 20). Shows a
          search input + a list of every eligible approver on this
          project. Already-picked approvers in this level render
          greyed-out with a green ✓; the rest get a + button that
          adds them and keeps the sheet open so the user can pick
          multiple without a round-trip. Close on tap-outside or Done. */}
      {/* Colab-parity activity-head bottom sheet · opens from the Step 1
          "Select Activity Head" button (video frame 11). Search filters
          the canonical head list; a user can also commit free-text when
          nothing matches ("Use '<text>' as the head"). */}
      {activityPickerOpen && (() => {
        const s = activitySearch.trim().toLowerCase();
        const matches = s
          ? ACTIVITY_HEADS.filter((h) => h.toLowerCase().includes(s))
          : ACTIVITY_HEADS;
        const canUseCustom =
          s.length >= 2 &&
          !ACTIVITY_HEADS.some((h) => h.toLowerCase() === s);
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            onClick={() => setActivityPickerOpen(false)}
          >
            <div
              className="w-full max-w-md max-h-[80vh] rounded-t-2xl bg-white p-5 pb-6 space-y-3 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="text-base font-semibold text-stone-900">Select Activity</p>
                <p className="text-[12px] text-stone-500 mt-0.5">
                  Pick the activity head this permit covers.
                </p>
              </div>
              <input
                type="search"
                value={activitySearch}
                onChange={(e) => setActivitySearch(e.target.value)}
                placeholder="Search Activity"
                autoFocus
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              />
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                {matches.length === 0 && !canUseCustom && (
                  <p className="text-[13px] text-stone-500 px-1 py-2 italic">
                    No matches.
                  </p>
                )}
                {matches.map((h) => {
                  const picked = h === activityHead;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        setActivityHead(h);
                        setActivityPickerOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left ${
                        picked
                          ? "border-ferrous-300 bg-sandstone-50"
                          : "border-stone-200 bg-white hover:bg-sandstone-50"
                      }`}
                    >
                      <div className="min-w-0 flex-1 text-[14px] text-ink">{h}</div>
                      {picked && <span className="text-emerald-500 text-base shrink-0">✓</span>}
                    </button>
                  );
                })}
                {canUseCustom && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivityHead(activitySearch.trim());
                      setActivityPickerOpen(false);
                    }}
                    className="w-full flex items-center gap-3 rounded-md border border-dashed border-ink px-3 py-2.5 text-left bg-white"
                  >
                    <div className="min-w-0 flex-1 text-[14px] text-ink">
                      Use &ldquo;{activitySearch.trim()}&rdquo; as the head
                    </div>
                    <span className="text-ink text-base shrink-0">+</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActivityPickerOpen(false)}
                className="w-full rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-semibold py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {approverSheetPos !== null && (() => {
        const level = approverLevels[approverSheetPos];
        if (!level) return null;
        const search = approverSearch.trim().toLowerCase();
        const matches = approverOptions.filter((u) =>
          !search ||
          u.name.toLowerCase().includes(search) ||
          u.username.toLowerCase().includes(search) ||
          (u.role ?? "").toLowerCase().includes(search),
        );
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            onClick={() => setApproverSheetPos(null)}
          >
            <div
              className="w-full max-w-md max-h-[80vh] rounded-t-2xl bg-white p-5 pb-6 space-y-3 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="text-base font-semibold text-stone-900">
                  Select Approver — Level {level.levelIndex}
                  {level.levelName.trim() ? ` (${level.levelName.trim()})` : ""}
                </p>
                <p className="text-[12px] text-stone-500 mt-0.5">
                  {level.userIds.size} picked. Pick as many as needed.
                </p>
              </div>
              <input
                type="search"
                value={approverSearch}
                onChange={(e) => setApproverSearch(e.target.value)}
                placeholder="Search person"
                autoFocus
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              />
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                {matches.length === 0 ? (
                  <p className="text-[13px] text-stone-500 px-1 py-2 italic">
                    No approvers match.
                  </p>
                ) : (
                  matches.map((u) => {
                    const alreadyPicked = level.userIds.has(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          if (!alreadyPicked) toggleApprover(approverSheetPos, u.id);
                        }}
                        disabled={alreadyPicked}
                        className={`w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left ${
                          alreadyPicked
                            ? "border-stone-100 bg-stone-50 cursor-not-allowed opacity-70"
                            : "border-stone-200 bg-white hover:bg-sandstone-50"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-600 flex items-center justify-center text-sm font-semibold shrink-0">
                          {(u.name?.[0] ?? "?").toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] text-ink truncate">{u.name}</div>
                          <div className="text-[11px] text-stone-500 truncate">
                            {u.role}
                          </div>
                        </div>
                        {alreadyPicked ? (
                          <span className="text-emerald-500 text-base shrink-0">✓</span>
                        ) : (
                          <span className="text-ink text-base shrink-0">+</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setApproverSheetPos(null)}
                className="w-full rounded-xl bg-ink text-white text-sm font-semibold py-2.5"
              >
                Done
              </button>
            </div>
          </div>
        );
      })()}
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
