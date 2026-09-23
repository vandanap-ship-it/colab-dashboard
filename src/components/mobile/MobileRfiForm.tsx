"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PhotoPicker from "@/components/PhotoPicker";
import VoiceTextarea from "@/components/VoiceTextarea";
import { useToast } from "@/components/Toast";
import SaveSuccessCard from "@/components/SaveSuccessCard";
import HowThisWorks from "@/components/HowThisWorks";
import {
  RFI_CATEGORIES,
  RFI_CATEGORY_LABELS,
  RFI_PRIORITIES,
  RFI_PRIORITY_LABELS,
  type RfiCategory,
  type RfiPriority,
} from "@/lib/rfi";

/**
 * Mobile "raise an RFI" form. Sequenced like the other mobile creates —
 * eyebrow → serif heading → step markers → cream cards — so the mental
 * model stays "another form of the same shape" rather than a
 * screen-specific layout.
 *
 * Fields kept minimal on purpose:
 *   - subject (one-liner)
 *   - category segmented pills (Structural / MEP / Architectural / Finishing / Other)
 *   - priority segmented pills (Low / Medium / High) — defaults to Medium
 *   - description (voice-enabled)
 *   - photos up to 4
 *
 * Advanced fields (assignee, due date, WBS link) stay on desktop for
 * now; the site engineer raising an RFI from the phone rarely knows the
 * right consultant, and defaulting to unassigned is more honest.
 */
export default function MobileRfiForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<RfiCategory>("STRUCTURAL");
  const [priority, setPriority] = useState<RfiPriority>("MEDIUM");
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | { queued: boolean; number?: number }>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3) {
      setError("Give the RFI a one-line subject.");
      return;
    }
    if (description.trim().length < 3) {
      setError("Add a description — what do you actually need answered?");
      return;
    }
    setPending(true);
    setError(null);

    let photoUrls: string[] = [];
    let photosNeedQueue: { filename: string; scope: string; blob: Blob }[] = [];
    if (photos.length > 0) {
      const scope = `rfi-${projectId}`;
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
      idempotencyKey: crypto.randomUUID(),
      projectId,
      subject: subject.trim(),
      description: description.trim(),
      category,
      priority,
      photoUrls,
    };
    const label = `RFI: ${subject.slice(0, 60)}`;

    if (photosNeedQueue.length > 0) {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({
        endpoint: "/api/rfi",
        method: "POST",
        body: payload,
        label,
        photos: photosNeedQueue,
        photosField: "photoUrls",
      });
      setPending(false);
      toast.info("Saved on this device. Photos will upload when you're back online.");
      setSaved({ queued: true });
      router.refresh();
      return;
    }

    let sent = false;
    let assignedNumber: number | undefined;
    try {
      const res = await fetch("/api/rfi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        sent = true;
        const data = await res.json().catch(() => null);
        assignedNumber = data?.rfi?.number;
      } else if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      } else {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/rfi", method: "POST", body: payload, label });
      }
    } catch {
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/rfi", method: "POST", body: payload, label });
    }
    setPending(false);
    if (sent) toast.success("RFI raised.");
    else toast.info("Saved on this device. It will sync when you're back online.");
    setSaved({ queued: !sent, number: assignedNumber });
    router.refresh();
  }

  function resetForm() {
    setSubject("");
    setDescription("");
    setCategory("STRUCTURAL");
    setPriority("MEDIUM");
    setPhotos([]);
    setError(null);
    setSaved(null);
  }

  /**
   * Keep the picked category + priority so an engineer filing a batch
   * of related RFIs (say three Structural High questions after a design
   * review) doesn't re-tap the same pills every time. Everything else
   * clears — this is a fresh RFI, just narrowed to a category and
   * urgency the engineer already knows.
   */
  function resetForNextOfSameKind() {
    setSubject("");
    setDescription("");
    setPhotos([]);
    setError(null);
    setSaved(null);
    // category, priority stay set
  }

  if (saved) {
    return (
      <SaveSuccessCard
        title="RFI raised"
        detail={
          saved.number
            ? `Filed as RFI-${String(saved.number).padStart(4, "0")}. Someone will pick it up in the RFI list.`
            : "Someone will pick it up in the RFI list once it syncs."
        }
        projectId={projectId}
        onAddAnother={resetForm}
        addAnotherSublabel="Fresh RFI, blank fields"
        contextAction={{
          label: `Log another ${RFI_CATEGORY_LABELS[category]} ${RFI_PRIORITY_LABELS[priority]} RFI`,
          sublabel: "Keeps the category and priority",
          onSelect: resetForNextOfSameKind,
        }}
        queued={saved.queued}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-5 space-y-6">
      <header>
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Request for information
        </p>
        <h1 className="font-serif text-[28px] leading-tight text-ink mt-1">
          Raise an RFI
        </h1>
      </header>

      <HowThisWorks
        title="How to raise an RFI"
        storageKey="siddhi.htw.rfi"
        steps={[
          "Write a one-line subject that says what you're asking about — e.g. \"Column rebar clash near V15 stair\".",
          "Pick the right category — Structural, MEP, Architectural, Finishing, or Other.",
          "Pick priority — Low if it can wait a week, Medium if you need it this week, High if work is already blocked.",
          "In the description, spell out exactly what needs answering. Tap the mic if you'd rather talk than type.",
          "Add 1 or 2 photos of the actual condition — they help the person answering way more than words.",
          "Tap Raise RFI. The consultant or planner will see it in their queue and answer.",
        ]}
      />

      {/* Subject */}
      <label className="block space-y-2">
        <span className="text-[13px] font-semibold text-ink">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Column reinforcement clash near V15 stair"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px]"
        />
      </label>

      {/* Category */}
      <section>
        <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em] mb-2">
          Category
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RFI_CATEGORIES.map((c) => {
            const active = c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full py-2 text-[13px] font-semibold ${
                  active ? "bg-ferrous-500 text-white" : "bg-sandstone-100 text-ink-2"
                }`}
              >
                {RFI_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Priority */}
      <section>
        <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em] mb-2">
          Priority
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RFI_PRIORITIES.map((p) => {
            const active = p === priority;
            const activeTone =
              p === "HIGH" ? "bg-red-500 text-white" : p === "LOW" ? "bg-stone-700 text-white" : "bg-amber-500 text-white";
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`rounded-full py-2 text-[13px] font-semibold ${
                  active ? activeTone : "bg-sandstone-100 text-ink-2"
                }`}
              >
                {RFI_PRIORITY_LABELS[p]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Description */}
      <label className="block space-y-2">
        <span className="text-[13px] font-semibold text-ink">What needs answering?</span>
        <p className="text-[12px] text-ink-3 -mt-1">
          Tap the mic and just talk — we&apos;ll write it down.
        </p>
        <VoiceTextarea
          rows={5}
          value={description}
          onChange={setDescription}
          placeholder="Rebar bar 4 clashing with slab dowel at grid B/4…"
        />
      </label>

      {/* Photos */}
      <div>
        <PhotoPicker photos={photos} setPhotos={setPhotos} max={4} label="Photos (optional)" />
        {photos.length === 0 && (
          <p className="mt-2 text-[12px] text-ink-3 leading-snug">
            One or two photos of the actual clash / condition help the answerer a lot.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || subject.trim().length < 3 || description.trim().length < 3}
        className="w-full rounded-full bg-ink text-cream py-4 text-[16px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
      >
        {pending ? "Sending…" : "Raise RFI"}
      </button>

      {error && <p className="text-sm text-ferrous-600">{error}</p>}
    </form>
  );
}
