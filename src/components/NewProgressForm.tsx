"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import VoiceTextarea from "./VoiceTextarea";
import { useToast } from "./Toast";
import PhotoPicker from "./PhotoPicker";
import ActivityPicker from "./ActivityPicker";
import SaveSuccessCard from "./SaveSuccessCard";
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

// Progress type — matches the Colab three-way. Labour Supply is the
// day-in day-out deployment count; PRW (Piece Rate Work) is paid per
// unit produced; Misc covers everything that isn't either. API zod
// accepts exactly these three literals.
type ProgressType = "LABOUR_SUPPLY" | "PRW" | "MISC";
const PROGRESS_TYPES: Array<{ code: ProgressType; label: string; hint: string }> = [
  { code: "LABOUR_SUPPLY", label: "Labour Supply", hint: "Daily labour deployment count" },
  { code: "PRW", label: "PRW", hint: "Piece-rate work · pay per unit" },
  { code: "MISC", label: "Misc.", hint: "Other progress" },
];

export default function NewProgressForm({
  projectId,
  initialActivityId,
}: {
  projectId: string;
  initialActivityId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const today = istDayString();

  // Which kind of progress this row is — defaults to Labour Supply because
  // that's ~95% of the daily entries. Segmented pills at the top of the
  // form so the engineer picks the type before they fill anything else.
  const [type, setType] = useState<ProgressType>("LABOUR_SUPPLY");
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
  // Formerly collapsed the notes/photos/labour section behind a toggle —
  // Shraddha flagged that as reading "optional" when it isn't. All fields
  // now expand inline; Save moves to the very bottom.
  // After save: show an in-place "Saved · Add another / Back to home" card
  // instead of redirecting to /mobile/{id}. Site engineers log many entries
  // per shift — booting them home every time forced 2 extra taps per entry.
  const [saved, setSaved] = useState<null | { queued: boolean }>(null);

  const totalQty = selected?.totalQuantity ?? 0;
  // pctState is authoritative — the slider always shows a 0-100 value.
  // `cumulative` is derived for API storage: proportional when totalQty > 0,
  // else the pctState itself so backend still gets a numeric value.
  const pct = pctState;
  const cumulative = totalQty > 0 ? (totalQty * pctState) / 100 : pctState;

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
    if (!activityId) {
      setError("Pick an activity first");
      return;
    }
    // Progress % is mandatory — a save with 0% would be indistinguishable
    // from an accidental submit and pollutes downstream reports.
    if (!(pctState > 0)) {
      setError("Drag the % slider — how much is done?");
      return;
    }
    setPending(true);
    setError(null);

    // Try to upload photos inline first (fast path). If the online upload
    // fails, we queue the whole entry WITH the raw photo blobs — the offline
    // queue's upload step will retry the photos on flush and then fire the
    // main entry POST. Nothing gets saved to prod without its photos.
    let photoUrls: string[] = [];
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
          photoUrls = upData.urls;
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
      type,
      achievedQuantity: achieved,
      cumulativeQuantity: cumulative,
      contractorId: contractorId || null,
      notes,
      // Labour headcount is a Labour Supply concept — PRW and Misc rows
      // shouldn't carry it, even if the engineer left the default zero-row
      // there before switching type at the last moment. Blank array keeps
      // the API contract simple.
      labour: type === "LABOUR_SUPPLY" ? labour : [],
      photoUrls,
      reasonCode: reasonCode || undefined,
      reasonNote: reasonNote.trim() || undefined,
    };
    const entryLabel = `Progress for ${selected?.name ?? "activity"}`;

    // Photos couldn't upload → queue the WHOLE entry with raw blobs. Skip the
    // online entry POST entirely so we don't create an entry without its
    // photos.
    if (photosNeedQueue.length > 0) {
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
      setSaved({ queued: true });
      router.refresh();
      return;
    }

    // Try the network first. If it succeeds, great — entry is saved and we
    // navigate away. If it fails (offline, slow signal, server hiccup), we
    // drop the entry into the offline queue.
    let saved = false;
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      toast.success("Progress saved.");
    } else {
      toast.info("Saved on this device. It will sync when you're back online.");
    }
    setSaved({ queued: !saved });
    router.refresh();
  }

  /**
   * Reset the entry-specific fields but KEEP the picked activity — a site
   * engineer logging progress typically enters the same villa/activity
   * again a few hours later at a new %, or hops to a nearby activity on
   * the same villa. Forcing them back through contractor → villa →
   * milestone picker every time was pure friction; the "Change" button on
   * the activity chip is one tap for the rare case where they need a
   * different villa.
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
  }

  if (saved) {
    return (
      <SaveSuccessCard
        title="Progress saved"
        // Tell the engineer exactly what "Add another" will do: keep this
        // villa/activity so they can just update whatever changed (a fresh
        // %, more labour, a photo) rather than re-picking from scratch.
        detail={
          selected
            ? `Logged for ${selected.name} · Block ${selected.path.blockCode} · ${selected.path.villaLabel}. Add another stays on this villa — just change what needs updating.`
            : "Add another stays on this villa — just change what needs updating."
        }
        projectId={projectId}
        onAddAnother={resetForm}
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
        <h1 className="font-serif text-[28px] leading-tight text-ink">
          Log progress
        </h1>
        <p className="text-[13px] text-ink-3 mt-1">
          Pick an activity, drag the % slider, then fill photos / notes /
          labour before you save.
        </p>
      </header>

      {/* Type tabs — segmented pills at the very top so the engineer
          picks Labour Supply / PRW / Misc. before anything else. The
          Colab equivalent is a mandatory dropdown; the pills are the
          same choice, one tap. Default is Labour Supply because that's
          ~95% of daily entries. */}
      <TypeTabs value={type} onChange={setType} />

      {/* Step 1 · Activity */}
      <section>
        <Step number={1} label={selected ? "Activity" : "Pick an activity"} />
        <div className="mt-3">
          {selected ? (
            <div className="rounded-2xl border border-sandstone-100 bg-cream px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-ink leading-tight">{selected.name}</div>
                <div className="text-[12px] text-ink-3 mt-0.5 truncate">
                  Block {selected.path.blockCode} · {selected.path.villaLabel} · {selected.path.sectionName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[13px] text-ferrous-600 hover:text-ferrous-700 inline-flex items-center gap-1 shrink-0"
                aria-label="Change activity"
              >
                <Pencil className="w-3.5 h-3.5" />
                Change
              </button>
            </div>
          ) : (
            <ActivityPicker
              projectId={projectId}
              initialActivityId={initialActivityId}
              onPick={(a) => {
                setSelected(a);
                setPctState(0);
              }}
            />
          )}
        </div>
      </section>

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
                    already uses, kept small since the site engineer will
                    only fill it if they're the person logging labour.
                    Hidden for PRW and Misc, where headcount isn't the
                    thing being tracked. */}
                {type === "LABOUR_SUPPLY" && (
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
                )}

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
              every part of the entry before committing. */}
          <button
            type="submit"
            disabled={pending || !activityId || pctState <= 0}
            className="w-full rounded-full bg-ink text-cream py-4 text-[16px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
          >
            {pending ? "Saving…" : "Save progress"}
          </button>
        </>
      )}

      {error && <p className="text-sm text-ferrous-600">{error}</p>}
    </form>
  );
}

/**
 * Segmented pills for Labour Supply / PRW / Misc — Colab parity. Sits
 * above the activity picker because the type frames what the rest of the
 * form is asking for (Labour Supply cares about headcount, PRW / Misc
 * don't). The active tab uses the same ferrous fill as the primary
 * action, so the "picked" state is unmistakable at a glance.
 */
function TypeTabs({ value, onChange }: { value: ProgressType; onChange: (v: ProgressType) => void }) {
  const active = PROGRESS_TYPES.find((t) => t.code === value) ?? PROGRESS_TYPES[0];
  return (
    <section aria-labelledby="progress-type-label">
      <div id="progress-type-label" className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em] mb-2">
        Type
      </div>
      <div role="tablist" aria-label="Progress type" className="grid grid-cols-3 gap-2">
        {PROGRESS_TYPES.map((t) => {
          const isActive = t.code === value;
          return (
            <button
              key={t.code}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.code)}
              className={`rounded-full py-2.5 text-[14px] font-semibold transition ${
                isActive
                  ? "bg-ferrous-500 text-white shadow-card"
                  : "bg-sandstone-100 text-ink-2 hover:bg-sandstone-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-ink-3 mt-2 leading-snug">{active.hint}</p>
    </section>
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
