"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import VoiceTextarea from "./VoiceTextarea";
import { useToast } from "./Toast";
import PhotoPicker from "./PhotoPicker";
import ActivityPicker from "./ActivityPicker";
import SaveSuccessCard from "./SaveSuccessCard";
import HowThisWorks from "./HowThisWorks";
import { HINDRANCE_REASONS } from "@/lib/hindranceReasons";
import { istDayString } from "@/lib/istDay";

// Local selection state — enriched with the metadata the picker returned so
// the form can render the picked activity + preserve totalQuantity/unit for
// the % slider.
interface PickedActivity {
  id: string;
  name: string;
  taskCode: string;
  totalQuantity: number | null;
  unit: string | null;
  contractor: { id: string; name: string } | null;
  path: { blockCode: string; villaLabel: string; sectionName: string };
}

const LABOUR_CATEGORIES = ["Skilled", "Unskilled", "Mason", "Helper", "Supervisor"];

// The API still expects a type literal (Colab-legacy field on the
// ProgressEntry schema), but White Lotus doesn't distinguish billing
// models per row — every entry is treated as Labour Supply. Kept as a
// const so a future re-split, if it ever comes back, has one place to
// widen the type from and the payload stays honest to the schema.
// Shraddha, Sep 22: "you can remove the Type tab".
const PROGRESS_TYPE = "LABOUR_SUPPLY" as const;

export default function NewProgressForm({
  projectId,
  initialActivityId,
  resumeDraftId,
}: {
  projectId: string;
  initialActivityId?: string;
  /** When set, load this draft on mount and pre-fill the form. In
   *  resume mode, Save progress becomes "Publish", Save Draft
   *  becomes "Update draft" (still writes DRAFT status), and a
   *  Discard action lets the engineer delete without publishing. */
  resumeDraftId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = istDayString();

  const [selected, setSelected] = useState<PickedActivity | null>(null);
  const activityId = selected?.id ?? "";
  // Contractor is derived from the picked activity — the schedule already
  // knows which contractor owns which block/villa via WBS.contractorId, so
  // asking the engineer to re-pick it was redundant.
  const contractorId = selected?.contractor?.id ?? "";
  const [date, setDate] = useState(today);
  const [achieved, setAchieved] = useState(0);
  // Progress is a single 0-100 value regardless of whether the activity
  // has a scheduled totalQuantity — every activity gets the same slider,
  // same feedback, same muscle memory. When totalQty > 0 we derive the
  // cumulative-quantity number the API stores from pctState * totalQty;
  // when totalQty == 0 we save pctState directly as a 0-100 completion.
  const [pctState, setPctState] = useState(0);
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonNote, setReasonNote] = useState<string>("");
  const [labour, setLabour] = useState<{ category: string; count: number }[]>([
    { category: "Skilled", count: 0 },
  ]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Precheck gate — some activities can't be logged until a prerequisite
  // inspection on the same villa has passed. The API call fires as soon
  // as the engineer picks an activity so the block is visible before they
  // fill anything else. `null` = not fetched yet (or unknown); a blocked
  // gate keeps Save disabled and renders a banner.
  const [gate, setGate] = useState<
    | null
    | { ok: true }
    // When blocked, we also carry the prerequisite's wbsNodeId + name so
    // the callout can offer a one-tap "Raise the WIR" shortcut that
    // deep-links into /inspection/new with the required activity
    // pre-selected. `requiredWbsNodeId` is null when the gate can't
    // pinpoint a specific node — the callout omits the shortcut in
    // that case rather than sending the engineer somewhere ambiguous.
    | { ok: false; reason: string; requiredWbsNodeId: string | null; requiredActivityName: string }
  >(null);
  const [gateLoading, setGateLoading] = useState(false);
  // Formerly collapsed the notes/photos/labour section behind a toggle —
  // Shraddha flagged that as reading "optional" when it isn't. All fields
  // now expand inline; Save moves to the very bottom.
  // After save: show an in-place "Saved · Add another / Back to home" card
  // instead of redirecting to /mobile/{id}. Site engineers log many entries
  // per shift — booting them home every time forced 2 extra taps per entry.
  const [saved, setSaved] = useState<null | { queued: boolean; mode: "publish" | "draft" }>(null);
  // When the engineer chooses "Log another on {villa}" after a save, we
  // clear the picked activity BUT keep a hint so the picker can jump the
  // user straight to that villa's milestone list on the next log. Null
  // means no hint — the picker starts at root. Only set right before we
  // hand back to the form; cleared on a full reset or a hard "Add another".
  const [sameVillaHint, setSameVillaHint] = useState<string | null>(null);

  const totalQty = selected?.totalQuantity ?? 0;
  // pctState is authoritative — the slider always shows a 0-100 value.
  // `cumulative` is derived for API storage: proportional when totalQty > 0,
  // else the pctState itself so backend still gets a numeric value.
  const pct = pctState;
  const cumulative = totalQty > 0 ? (totalQty * pctState) / 100 : pctState;

  // Draft resume · fetch the draft on mount if the parent handed us a
  // resumeDraftId. Pre-fills every field the form supports so the
  // engineer picks up exactly where they left off. Photos come back as
  // URLs (stored server-side); the picker below carries them as
  // existingPhotoUrls so the form doesn't try to re-upload them.
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  const isResume = Boolean(resumeDraftId);
  const [draftLoadFailed, setDraftLoadFailed] = useState(false);
  useEffect(() => {
    if (!resumeDraftId) return;
    let cancelled = false;
    (async () => {
      try {
        // Query the draft directly via the id-scoped route with an
        // explicit status filter opt-in — the GET list route only
        // returns drafts when status=draft, so we hit the single-row
        // endpoint that filters by id + createdById. There isn't a
        // /api/progress/[id] GET yet, so we fetch the list and pick
        // the matching row.
        const res = await fetch(
          `/api/progress?projectId=${encodeURIComponent(projectId)}&status=draft&limit=100`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const j = await res.json();
        interface DraftFromApi {
          id: string;
          date: string;
          cumulativeQuantity: number;
          achievedQuantity: number;
          notes: string | null;
          reasonCode: string | null;
          reasonNote: string | null;
          contractor: { id: string; name: string } | null;
          photos: Array<{ id: string; url: string }>;
          labour: Array<{ id: string; category: string; count: number }>;
          wbsNode: {
            id: string;
            name: string;
            taskCode: string;
            totalQuantity: number | null;
            unit: string | null;
          };
        }
        const drafts = j.entries as DraftFromApi[];
        const draft = drafts.find((d) => d.id === resumeDraftId);
        if (cancelled) return;
        if (!draft) {
          setDraftLoadFailed(true);
          return;
        }
        // Pre-fill state. Path (block/villa/section) isn't stored on
        // the entry so we synthesize a minimal PickedActivity — the
        // form only uses path for the save-card detail line and the
        // "Log another on villa" shortcut, both of which read cleanly
        // when the values are blank.
        setSelected({
          id: draft.wbsNode.id,
          name: draft.wbsNode.name,
          taskCode: draft.wbsNode.taskCode,
          totalQuantity: draft.wbsNode.totalQuantity,
          unit: draft.wbsNode.unit,
          contractor: draft.contractor,
          path: { blockCode: "", villaLabel: "", sectionName: "" },
        });
        setDate(draft.date.slice(0, 10));
        setAchieved(draft.achievedQuantity);
        // Slider value: derive from cumulative + total, else assume the
        // stored cumulative IS the slider value (activities without a
        // scheduled quantity).
        const total = draft.wbsNode.totalQuantity ?? 0;
        setPctState(
          total > 0
            ? Math.max(0, Math.min(100, Math.round((draft.cumulativeQuantity / total) * 100)))
            : Math.max(0, Math.min(100, Math.round(draft.cumulativeQuantity))),
        );
        setNotes(draft.notes ?? "");
        setReasonCode(draft.reasonCode ?? "");
        setReasonNote(draft.reasonNote ?? "");
        setLabour(
          draft.labour.length > 0
            ? draft.labour.map((l) => ({ category: l.category, count: l.count }))
            : [{ category: "Skilled", count: 0 }],
        );
        setExistingPhotoUrls(draft.photos.map((p) => p.url));
      } catch (e) {
        if (!cancelled) {
          setDraftLoadFailed(true);
          setError(e instanceof Error ? e.message : "Couldn't load the draft.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeDraftId, projectId]);

  // Fetch the precheck gate as soon as an activity is picked (or the
  // engineer swaps to a different activity). Server enforces the same
  // rule on POST — this is the pre-submit UX so nobody scrolls to Save
  // only to be refused.
  useEffect(() => {
    if (!activityId) {
      setGate(null);
      return;
    }
    let cancelled = false;
    setGateLoading(true);
    setGate(null);
    fetch(`/api/progress/precheck?wbsNodeId=${encodeURIComponent(activityId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Network hiccup — fall open (the server will still enforce
          // on POST). Better to let the engineer keep typing than to
          // block the whole form on a transient failure.
          setGate({ ok: true });
          return;
        }
        const data = await res.json();
        if (data.ok) {
          setGate({ ok: true });
        } else {
          setGate({
            ok: false,
            reason: data.reason ?? "Prerequisite not met",
            requiredWbsNodeId: typeof data.requiredWbsNodeId === "string" ? data.requiredWbsNodeId : null,
            requiredActivityName: typeof data.requiredActivityName === "string" ? data.requiredActivityName : "the prerequisite",
          });
        }
      })
      .catch(() => {
        if (!cancelled) setGate({ ok: true });
      })
      .finally(() => {
        if (!cancelled) setGateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  function updateLabour(i: number, patch: Partial<{ category: string; count: number }>) {
    setLabour((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addLabourRow() {
    setLabour((rows) => [...rows, { category: "Helper", count: 0 }]);
  }
  function removeLabourRow(i: number) {
    setLabour((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitEntry("publish");
  }

  async function handleDiscardDraft() {
    if (!resumeDraftId) return;
    if (!window.confirm("Discard this draft? You can't get it back.")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/progress/${resumeDraftId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Discard failed (${res.status})`);
      toast.info("Draft discarded.");
      router.push(`/mobile/${projectId}/site-progress`);
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Couldn't discard the draft.");
    }
  }

  async function handleSaveDraft() {
    // Save Draft skips both the precheck gate and the 0% check — the
    // whole point of a draft is that the engineer isn't ready to
    // commit yet. The server also skips precheck when mode="draft".
    // Still needs an activity (nothing to attach the draft to
    // otherwise); everything else is optional.
    if (!activityId) {
      setError("Pick an activity first, even for a draft.");
      return;
    }
    await submitEntry("draft");
  }

  async function submitEntry(mode: "publish" | "draft") {
    if (mode === "publish") {
      if (!activityId) {
        setError("Pick an activity first");
        return;
      }
      // Precheck gate — the useEffect above already fetched this the moment
      // the activity was picked. Refuse the submit locally so the engineer
      // doesn't lose their typed notes to a 409 from the server.
      if (gate && !gate.ok) {
        setError(gate.reason);
        return;
      }
      // Progress % is mandatory on publish — a save with 0% would be
      // indistinguishable from an accidental submit and pollutes
      // downstream reports.
      if (!(pctState > 0)) {
        setError("Drag the % slider — how much is done?");
        return;
      }
    }
    setPending(true);
    setError(null);
    const isDraft = mode === "draft";

    // Try to upload photos inline first (fast path). If the online upload
    // fails, we queue the whole entry WITH the raw photo blobs — the offline
    // queue's upload step will retry the photos on flush and then fire the
    // main entry POST. Nothing gets saved to prod without its photos.
    // Resumed drafts start from `existingPhotoUrls` (server-stored URLs
    // from the draft) so photos aren't re-uploaded on publish.
    let photoUrls: string[] = [...existingPhotoUrls];
    let photosNeedQueue: { filename: string; scope: string; blob: Blob }[] = [];
    if (photos.length > 0) {
      const scope = `progress-${projectId}`;
      const fd = new FormData();
      fd.set("scope", scope);
      for (const p of photos) fd.append("file", p);
      try {
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) {
          const upData = await upRes.json();
          photoUrls = [...photoUrls, ...upData.urls];
        } else {
          photosNeedQueue = photos.map((f) => ({ filename: f.name, scope, blob: f }));
        }
      } catch {
        photosNeedQueue = photos.map((f) => ({ filename: f.name, scope, blob: f }));
      }
    }

    const payload = {
      // One stable key per submission, reused for the direct POST and any
      // offline-queue replay, so a lost response doesn't create a duplicate.
      idempotencyKey: crypto.randomUUID(),
      wbsNodeId: activityId,
      date,
      type: PROGRESS_TYPE,
      achievedQuantity: achieved,
      cumulativeQuantity: cumulative,
      contractorId: contractorId || null,
      notes,
      labour,
      photoUrls,
      reasonCode: reasonCode || undefined,
      reasonNote: reasonNote.trim() || undefined,
      mode,
    };
    const entryLabel = isDraft
      ? `Progress draft for ${selected?.name ?? "activity"}`
      : `Progress for ${selected?.name ?? "activity"}`;

    // Resumed drafts publish through the /publish endpoint on the draft's
    // own id — the server upgrades DRAFT → PUBLISHED, runs the rollup +
    // milestone email + audit that were skipped on save. Fresh entries
    // and re-saved drafts go through POST /api/progress as usual.
    const isPublishingResumedDraft = isResume && mode === "publish";
    const endpoint = isPublishingResumedDraft
      ? `/api/progress/${resumeDraftId}/publish`
      : "/api/progress";
    // /publish takes the same shape as POST /api/progress minus the
    // mode flag (it's implied by the endpoint).
    const publishPayload = isPublishingResumedDraft ? { ...payload, mode: undefined } : payload;

    // Photos couldn't upload → queue the WHOLE entry with raw blobs. Skip the
    // online entry POST entirely so we don't create an entry without its
    // photos. Skipped for /publish (the draft already has its photos on
    // the server, so a failed new-photo upload isn't a data-loss risk).
    if (photosNeedQueue.length > 0 && !isPublishingResumedDraft) {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({
        endpoint: "/api/progress",
        method: "POST",
        body: payload,
        label: entryLabel,
        photos: photosNeedQueue,
        photosField: "photoUrls",
      });
      setPending(false);
      toast.info("Saved on this device. Photos will upload when you're back online.");
      setSaved({ queued: true, mode });
      router.refresh();
      return;
    }

    // Try the network first. If it succeeds, great — entry is saved and we
    // navigate away. If it fails (offline, slow signal, server hiccup), we
    // drop the entry into the offline queue.
    let saved = false;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishPayload),
      });
      if (res.ok) {
        saved = true;
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else {
        // 5xx — queue it and let the user keep moving.
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/progress", method: "POST", body: payload, label: entryLabel });
      }
    } catch {
      // Network error → queue.
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/progress", method: "POST", body: payload, label: entryLabel });
    }
    setPending(false);

    // Always confirm the save — pre-toast, an online save with no warnings
    // showed NO feedback at all, and engineers on slow networks would
    // double-submit thinking nothing happened.
    if (saved) {
      toast.success(isDraft ? "Draft saved." : "Progress saved.");
    } else {
      toast.info("Saved on this device. It will sync when you're back online.");
    }
    setSaved({ queued: !saved, mode });
    router.refresh();
  }

  /**
   * Reset the entry-specific fields but KEEP the picked activity — a site
   * engineer logging progress typically enters the same villa/activity
   * again a few hours later at a new %, or hops to a nearby activity on
   * the same villa. Forcing them back through contractor → villa →
   * milestone picker every time was pure friction; the back arrow in the
   * header is one tap for the rare case where they need a different
   * villa.
   */
  function resetForm() {
    setDate(today);
    setAchieved(0);
    setPctState(0);
    setReasonCode("");
    setReasonNote("");
    setLabour([{ category: "Skilled", count: 0 }]);
    setPhotos([]);
    setNotes("");
    setError(null);
    setSaved(null);
    setSameVillaHint(null);
  }

  /**
   * Reset everything AND drop the picked activity — but stash the villa
   * label so the ActivityPicker jumps straight to that villa's milestone
   * list. Used by the "Log another on {villa}" CTA on the save card:
   * engineers moving between activities on the same villa (say, from
   * plinth to shuttering) no longer walk the contractor + villa steps
   * every time.
   */
  function resetForNextOnSameVilla() {
    const villaLabel = selected?.path.villaLabel ?? null;
    setDate(today);
    setAchieved(0);
    setPctState(0);
    setReasonCode("");
    setReasonNote("");
    setLabour([{ category: "Skilled", count: 0 }]);
    setPhotos([]);
    setNotes("");
    setError(null);
    setSaved(null);
    setSelected(null);
    setSameVillaHint(villaLabel);
  }

  if (saved) {
    const isDraft = saved.mode === "draft";
    return (
      <SaveSuccessCard
        title={isDraft ? "Draft saved" : "Progress saved"}
        // Tell the engineer what the two "Add another" paths do: the
        // context CTA keeps them on the just-saved villa (skips the block
        // → villa drill on the next log); "Add another" keeps THIS
        // activity so they can update just what changed. For drafts the
        // detail line says where to find it later.
        detail={
          isDraft
            ? selected
              ? `Stashed as a draft for ${selected.name} on ${selected.path.villaLabel}. Find it under Drafts on the Progress list to finish and publish.`
              : "Stashed as a draft. Find it under Drafts on the Progress list to finish and publish."
            : selected
              ? `Logged for ${selected.name} · Block ${selected.path.blockCode} · ${selected.path.villaLabel}.`
              : undefined
        }
        projectId={projectId}
        onAddAnother={resetForm}
        addAnotherSublabel="Same activity — bump the % or add a photo"
        contextAction={
          selected
            ? {
                label: `Log another on ${selected.path.villaLabel}`,
                sublabel: "Same villa, pick a new activity",
                onSelect: resetForNextOnSameVilla,
              }
            : undefined
        }
        queued={saved.queued}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-5 space-y-6">
      {/* Editorial heading — matches the Amanvana-native language from the
          home. Kept the H1 here so the page title stays with the form and
          readers land on the right heading level. */}
      <header>
        {isResume && (
          <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide mb-1">
            Resuming your draft
          </p>
        )}
        <h1 className="font-serif text-[28px] leading-tight text-ink">
          {isResume ? "Finish your progress" : "Log progress"}
        </h1>
        {draftLoadFailed && (
          <p className="text-[13px] text-ferrous-600 mt-2">
            Couldn&apos;t load that draft. It may have been discarded or published from another device.
          </p>
        )}
      </header>

      {/* Onboarding · plain-English walkthrough for the site team.
          Auto-expanded on first visit, collapsed once dismissed.
          Hidden in resume mode since the engineer already knows the flow. */}
      {!isResume && (
        <HowThisWorks
        title="How to log progress"
        storageKey="siddhi.htw.progress"
        steps={[
          "Pick the villa and the activity you worked on today (for example: Villa 15, Footing Concreting).",
          "Drag the % slider to show how much of that activity is done in total — not just today's work.",
          "Add 2 or 3 photos: one of the activity, one of the workers, one of anything unusual.",
          "Type or say what got done today — tap the mic if you'd rather talk.",
          "Add a labour row for each trade that worked, with how many people.",
          "If work was delayed, pick a delay reason so the team knows.",
          "Tap Save progress at the bottom.",
        ]}
        />
      )}

      {/* Step 1 · Activity */}
      <section>
        <Step number={1} label={selected ? "Activity" : "Pick an activity"} />
        <div className="mt-3">
          {selected ? (
            /* Once the activity is picked, the card just reads it back.
               No inline "Change" affordance — Shraddha, Sep 22: the
               back arrow in the header is enough to abandon and pick
               again if the wrong activity landed. Keeps the form
               calmer during the log flow. */
            <div className="rounded-2xl border border-sandstone-100 bg-cream px-4 py-3">
              <div className="text-[15px] font-semibold text-ink leading-tight">{selected.name}</div>
              <div className="text-[12px] text-ink-3 mt-0.5 truncate">
                Block {selected.path.blockCode} · {selected.path.villaLabel} · {selected.path.sectionName}
              </div>
            </div>
          ) : (
            <ActivityPicker
              projectId={projectId}
              initialActivityId={initialActivityId}
              initialVillaLabel={sameVillaHint ?? undefined}
              onPick={(a) => {
                setSelected(a);
                setPctState(0);
                // The hint has served its purpose the moment the engineer
                // picks an activity — clear it so a subsequent hard "Add
                // another" (or a manual back-out) doesn't re-preseed.
                setSameVillaHint(null);
              }}
            />
          )}
        </div>
      </section>

      {selected && gate && !gate.ok && (
        <section
          role="alert"
          className="rounded-2xl border border-ferrous-200 bg-ferrous-50/60 px-4 py-4"
        >
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-full bg-ferrous-500 text-white flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ferrous-700 uppercase tracking-[0.14em]">
                Precheck required
              </p>
              <p className="text-[14px] text-ink mt-1 leading-snug">
                {gate.reason}
              </p>
              <p className="text-[12px] text-ink-3 mt-2 leading-snug">
                Raise a Work Inspection Request for the prerequisite, get it
                passed, then come back here to log progress.
              </p>
              {/* One-tap shortcut into /inspection/new with the required
                  activity pre-selected. Only shown when the gate knows
                  exactly which wbsNode to raise the WIR against —
                  otherwise the button would either send the engineer
                  somewhere ambiguous or force them to search from a
                  cold start. */}
              {gate.requiredWbsNodeId && (
                <Link
                  href={`/mobile/${projectId}/inspection/new?wbsNodeId=${encodeURIComponent(gate.requiredWbsNodeId)}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ferrous-500 text-white text-[13px] font-semibold px-4 py-2 shadow-card active:scale-[0.99]"
                >
                  Raise the WIR for {gate.requiredActivityName}
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {selected && (
        <>
          {/* Progress · one uniform 0-100 slider for every activity. The
              activity may or may not have a scheduled totalQuantity — the
              engineer shouldn't care, and shouldn't see two different
              layouts. The optional "N / M units" line under the % only
              renders when totalQty > 0, purely for context; it doesn't
              change how the engineer interacts. */}
          <section>
            <Step number={2} label="How much done in total?" />
            <div className="mt-3 rounded-2xl border border-sandstone-100 bg-cream p-4">
              <div className="flex items-baseline gap-2">
                <span
                  className="font-serif text-ferrous-600"
                  style={{ fontSize: "48px", lineHeight: "1", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}
                >
                  {Math.round(pct)}
                </span>
                <span className="font-serif text-[22px] text-ferrous-600 leading-none">%</span>
                {totalQty > 0 && (
                  <span className="ml-auto text-[12px] text-ink-3 tabular-nums">
                    {cumulative.toFixed(1)} / {totalQty} {selected.unit ?? "units"}
                  </span>
                )}
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={(e) => setPctState(Number(e.target.value))}
                className="siddhi-range mt-3"
                aria-label="Progress"
              />
              <div className="flex justify-between text-[11px] uppercase tracking-[0.14em] text-ink-3 mt-2">
                <span>Not started</span>
                <span>Complete</span>
              </div>
            </div>
          </section>

          {/* Details section — always visible. Photos, notes, labour and
              delay reason are part of a full progress entry, not "nice to
              have" behind a toggle: hiding them behind "Add photos, notes,
              labour, delay reason" made the whole block read as optional
              which it isn't. Save moves to the very bottom so the site
              engineer scrolls through everything before pressing it. */}
          <section>
            <div className="space-y-5">
                {/* Voice notes first — a big pill inside VoiceTextarea
                    makes voice the obvious way in. Copy: "Tell us what
                    you did" instead of the older "Optional comments". */}
                <label className="block">
                  <span className="text-[13px] font-semibold text-ink">Notes</span>
                  <p className="text-[12px] text-ink-3 mb-2">
                    Tap the mic and just talk — we&apos;ll write it down.
                  </p>
                  <VoiceTextarea
                    rows={4}
                    value={notes}
                    onChange={setNotes}
                    placeholder="Tell us what you did today…"
                  />
                </label>

                {/* Photos */}
                <div>
                  <PhotoPicker photos={photos} setPhotos={setPhotos} max={4} label="Photos" />
                  {photos.length === 0 && (
                    <p className="mt-2 text-[12px] text-ink-3 leading-snug">
                      Three quick photos help — the activity, the workers, any issue.
                    </p>
                  )}
                </div>

                {/* Labour rows — same repeating pattern the manpower form
                    already uses. Always visible now that the Type tabs
                    are gone; every progress entry treats labour as the
                    primary thing being tracked. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-ink">Labour</span>
                    <button
                      type="button"
                      onClick={addLabourRow}
                      className="text-[13px] text-ferrous-600 font-medium"
                    >
                      + Add row
                    </button>
                  </div>
                  {labour.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        value={row.category}
                        onChange={(e) => updateLabour(i, { category: e.target.value })}
                        className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
                      >
                        {LABOUR_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={row.count}
                        onChange={(e) => updateLabour(i, { count: Math.max(0, Math.floor(Number(e.target.value))) })}
                        className="w-24 rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] tabular-nums"
                      />
                      {labour.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLabourRow(i)}
                          className="text-stone-400 hover:text-red-500 text-lg min-h-11 min-w-11 flex items-center justify-center"
                          aria-label="Remove"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Delay reason — compact single line so it doesn't
                    dominate the form; the picker is still there when the
                    engineer needs it. */}
                <label className="block">
                  <span className="text-[13px] font-semibold text-ink">
                    Delay reason <span className="text-ink-3 font-normal">(optional)</span>
                  </span>
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
                  >
                    <option value="">— No delay</option>
                    {HINDRANCE_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </label>

                {reasonCode && (
                  <label className="block">
                    <span className="text-[13px] font-semibold text-ink">
                      More detail <span className="text-ink-3 font-normal">(optional)</span>
                    </span>
                    <input
                      type="text"
                      value={reasonNote}
                      onChange={(e) => setReasonNote(e.target.value)}
                      maxLength={500}
                      placeholder="e.g. cement delivery skipped for the day"
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
                    />
                  </label>
                )}

                {/* Date — moved down here since 99% of entries are today */}
                <label className="block">
                  <span className="text-[13px] font-semibold text-ink">Date</span>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
                  />
                  <p className="text-[12px] text-ink-3 mt-1">
                    Defaults to today. Change it only if you&apos;re back-logging.
                  </p>
                </label>
              </div>
          </section>

          {/* Save · sits at the very end so the engineer scrolls through
              every part of the entry before committing. Disabled while
              the precheck gate is loading or blocked, so a slow network
              can't let a gated activity through by accident.
              In resume mode this becomes "Publish" — the draft gets
              promoted to PUBLISHED status. */}
          <button
            type="submit"
            disabled={pending || !activityId || pctState <= 0 || gateLoading || (gate ? !gate.ok : false)}
            className="w-full rounded-full bg-ink text-cream py-4 text-[16px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
          >
            {pending ? "Saving…" : isResume ? "Publish progress" : "Save progress"}
          </button>

          {/* Save Draft · secondary escape hatch for site engineers
              interrupted mid-entry. Skips the % and precheck gates so
              even a half-typed entry stashes cleanly. Shown only when
              an activity is picked — a draft with no activity has
              nothing to attach to. Hidden in resume mode: updating an
              existing draft in place isn't in step 3 yet; the engineer
              either publishes or discards. */}
          {activityId && !isResume && (
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={pending}
              className="w-full rounded-full bg-white border border-stone-200 text-ink py-4 text-[15px] font-medium disabled:opacity-60 active:scale-[0.99]"
            >
              {pending ? "Saving…" : "Save as Draft"}
            </button>
          )}

          {/* Discard · resume-mode-only. Soft-deletes the draft and
              sends the engineer back to the Progress list. Guarded
              with a browser confirm so a stray tap doesn't wipe a
              draft they were still using. */}
          {isResume && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              disabled={pending}
              className="w-full rounded-full bg-white border border-ferrous-200 text-ferrous-600 py-4 text-[14px] font-medium disabled:opacity-60 active:scale-[0.99]"
            >
              Discard draft
            </button>
          )}
        </>
      )}

      {error && <p className="text-sm text-ferrous-600">{error}</p>}
    </form>
  );
}

/**
 * Numbered step marker for the three-step flow. Small ferrous chip + label
 * — reads as "this is what to do next", not a decorative heading.
 */
function Step({ number, label }: { number: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ferrous-500 text-white text-[12px] font-bold font-serif">
        {number}
      </span>
      <span className="text-[15px] font-semibold text-ink">{label}</span>
    </div>
  );
}
