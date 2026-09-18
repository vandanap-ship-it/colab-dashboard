"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Calendar, Camera, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { HINDRANCE_REASONS } from "@/lib/hindranceReasons";

// Types for the data we load on mount.
type Activity = { id: string; name: string; taskCode: string; path: string[]; isLeaf: boolean };
type Contractor = { id: string; name: string; category: string };

/**
 * Mobile-native hindrance form. Card-per-field layout mirrors the reference
 * Colab flow site engineers already know, so we don't retrain anyone before
 * cutover — same fields in the same order, same required markers.
 *
 * What this form asks for:
 *   1. Hindrance         — reason code (Materials, Labour, RMC, …)
 *   2. Responsible Contractor
 *   3. Responsible Team  (free text; no Team model yet)
 *   4. Location          — WBS node (block or villa)
 *   5. Description       — what happened
 *   6. Reason For Hindrance — free-text root cause detail
 *   7. From Date & Time  — start of the blocker window
 *   8. To Date & Time    — end (expected or actual)
 *   9. Calculated Duration (derived; not sent)
 *  10. Cost Impact       — INR ₹
 *  11. Upload File/Photo — up to 4 photos
 *
 * We deliberately keep this as a single component rather than plugging into
 * the generic ReportForm — the reference layout is opinionated (card grid,
 * dashed textareas, computed duration) and fighting the generic component
 * cost more code than owning it here.
 */
export default function MobileHindranceForm({
  projectId,
  successPath,
}: {
  projectId: string;
  successPath: string;
}) {
  const router = useRouter();
  const toast = useToast();

  // Data loaded async.
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state — one key per field in the reference.
  const [reasonCode, setReasonCode] = useState("");
  const [responsibleContractorId, setResponsibleContractorId] = useState("");
  const [responsibleTeam, setResponsibleTeam] = useState("");
  const [wbsNodeId, setWbsNodeId] = useState("");
  const [description, setDescription] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  // Store as datetime-local values (YYYY-MM-DDTHH:mm). Default From = now,
  // To = now — the reference defaults both to the current moment so the
  // engineer only edits what changed.
  const nowLocal = toDatetimeLocal(new Date());
  const [startAt, setStartAt] = useState(nowLocal);
  const [endAt, setEndAt] = useState(nowLocal);
  const [costImpact, setCostImpact] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wbsRes, contractorsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/wbs`, { cache: "no-store" }),
          fetch(`/api/admin/contractors?projectId=${projectId}`, { cache: "no-store" }),
        ]);
        if (!wbsRes.ok) throw new Error(`WBS ${wbsRes.status}`);
        if (!contractorsRes.ok) throw new Error(`Contractors ${contractorsRes.status}`);
        const wbsData = (await wbsRes.json()) as { nodes?: Activity[] };
        const cData = (await contractorsRes.json()) as { contractors?: Contractor[] };
        if (cancelled) return;
        setActivities(Array.isArray(wbsData.nodes) ? wbsData.nodes : []);
        setContractors(Array.isArray(cData.contractors) ? cData.contractors : []);
      } catch (e) {
        if (!cancelled) {
          setActivities([]);
          setContractors([]);
          setLoadError(e instanceof Error ? e.message : "Couldn't load form data");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Locations = WBS nodes above the deep leaf (blocks + villas). Anything
  // named "Amanvana Phase 1" (the project root) is stripped from the path so
  // the picker reads "BLOCK A / Villa 12" not "Amanvana Phase 1 / BLOCK A /
  // Villa 12". Search matches both the leaf name and the crumb trail.
  const filteredLocations = useMemo(() => {
    if (!activities) return [];
    const q = locationSearch.trim().toLowerCase();
    // Keep every non-leaf level plus villa-level leaves — hides the flood of
    // activity-level leaves that come out of the Colab CSV. If a project has
    // no explicit villa layer this falls back to the full list.
    const asLocations = activities.filter(
      (a) => !a.isLeaf || a.name.toLowerCase().startsWith("villa"),
    );
    const effective = asLocations.length > 0 ? asLocations : activities;
    if (!q) return effective.slice(0, 60);
    return effective
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.path.join(" / ").toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [activities, locationSearch]);

  const selectedLocation = useMemo(
    () => activities?.find((a) => a.id === wbsNodeId) ?? null,
    [activities, wbsNodeId],
  );

  // Duration between From/To in whole minutes → surfaced as "Xd Yh Zmin"
  // depending on scale, matching the reference's "0min" default.
  const durationLabel = useMemo(() => {
    const s = parseDatetimeLocal(startAt);
    const e = parseDatetimeLocal(endAt);
    if (!s || !e) return "—";
    const diffMs = e.getTime() - s.getTime();
    if (diffMs <= 0) return "0min";
    const mins = Math.floor(diffMs / 60000);
    const days = Math.floor(mins / (60 * 24));
    const hrs = Math.floor((mins - days * 60 * 24) / 60);
    const rem = mins - days * 60 * 24 - hrs * 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hrs) parts.push(`${hrs}h`);
    if (rem || parts.length === 0) parts.push(`${rem}min`);
    return parts.join(" ");
  }, [startAt, endAt]);

  const requiredMissing =
    !reasonCode || !wbsNodeId || description.trim().length < 3 || reasonNote.trim().length < 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requiredMissing) {
      setError("Fill in the required fields (marked *)");
      return;
    }
    setPending(true);
    setError(null);

    // Upload photos first (same pattern as the generic ReportForm). If upload
    // fails we still save the record — a hindrance without a photo is fine.
    let photoUrls: string[] = [];
    let photoWarning: string | null = null;
    if (photos.length > 0) {
      const fd = new FormData();
      fd.set("scope", `hindrance-${projectId}`);
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

    const start = parseDatetimeLocal(startAt);
    const end = parseDatetimeLocal(endAt);
    const costNum = costImpact.trim() ? Number(costImpact) : undefined;

    const payload: Record<string, unknown> = {
      idempotencyKey: crypto.randomUUID(),
      projectId,
      wbsNodeId,
      description: description.trim(),
      reasonCode,
      reasonNote: reasonNote.trim(),
      startDate: (start ?? new Date()).toISOString(),
      endDate: end ? end.toISOString() : null,
      responsibleContractorId: responsibleContractorId || null,
      responsibleTeam: responsibleTeam.trim() || null,
      costImpact: Number.isFinite(costNum) ? costNum : null,
      photoUrls,
    };

    try {
      const res = await fetch("/api/hindrances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setPending(false);
        if (photoWarning) toast.warning(photoWarning);
        toast.success("Hindrance logged.");
        router.push(successPath);
        router.refresh();
        return;
      }
      if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        setPending(false);
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      }
      // 5xx → offline queue, same as the generic form.
      const { enqueue } = await import("@/lib/offlineQueue");
      await enqueue({ endpoint: "/api/hindrances", method: "POST", body: payload, label: "Hindrance" });
      setPending(false);
      toast.info("Saved on this device. It will sync when you're back online.");
      router.push(successPath);
    } catch (err) {
      // Network offline. Queue and continue.
      try {
        const { enqueue } = await import("@/lib/offlineQueue");
        await enqueue({ endpoint: "/api/hindrances", method: "POST", body: payload, label: "Hindrance" });
        setPending(false);
        toast.info("Saved on this device. It will sync when you're back online.");
        router.push(successPath);
      } catch (qe) {
        setPending(false);
        setError(
          `Couldn't save and this device can't hold it offline: ${
            err instanceof Error ? err.message : "network error"
          } · ${qe instanceof Error ? qe.message : "storage unavailable"}`,
        );
      }
    }
  }

  return (
    <div className="min-h-full bg-ivory">
      {/* Hero band — sandstone gradient to match the mobile home, and a
          Fraunces title so the visual language is consistent across every
          mobile screen. The Back arrow lives in the layout header. */}
      <div
        className="px-5 pt-5 pb-6 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Something holding a job up?
        </p>
        <h1 className="font-serif text-[28px] leading-tight text-ink mt-1 tracking-tight">
          Add hindrance
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-3.5 pb-24">
        {/* 1. Hindrance (reasonCode) — required */}
        <FieldCard label="Hindrance" required>
          <SelectShell placeholder="Please select Hindrance">
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full"
              aria-label="Hindrance"
            >
              <option value="">Please select Hindrance</option>
              {HINDRANCE_REASONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
            <span className={reasonCode ? "text-stone-900" : "text-stone-400"}>
              {reasonCode
                ? HINDRANCE_REASONS.find((r) => r.code === reasonCode)?.label ?? reasonCode
                : "Please select Hindrance"}
            </span>
          </SelectShell>
        </FieldCard>

        {/* 2. Responsible Contractor */}
        <FieldCard label="Responsible Contractor">
          <SelectShell placeholder="Select Contractors">
            <select
              value={responsibleContractorId}
              onChange={(e) => setResponsibleContractorId(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full"
              aria-label="Responsible Contractor"
              disabled={contractors === null}
            >
              <option value="">
                {contractors === null ? "Loading contractors…" : "Select Contractors"}
              </option>
              {(contractors ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span className={responsibleContractorId ? "text-stone-900" : "text-stone-400"}>
              {responsibleContractorId
                ? contractors?.find((c) => c.id === responsibleContractorId)?.name ?? "—"
                : "Select Contractors"}
            </span>
          </SelectShell>
        </FieldCard>

        {/* 3. Responsible Team — free text (no Team model yet). Placeholder
              matches the reference dropdown copy so the field reads the same
              even though it accepts anything. */}
        <FieldCard label="Responsible Team">
          <div className="relative flex items-center rounded-lg bg-stone-100 px-4 h-12">
            <input
              type="text"
              value={responsibleTeam}
              onChange={(e) => setResponsibleTeam(e.target.value)}
              placeholder="Select Teams"
              className="w-full bg-transparent outline-none text-stone-900 placeholder:text-stone-400"
            />
          </div>
        </FieldCard>

        {/* 4. Location Selection — required. Custom picker rather than a
              native select because the WBS list has 3-4 crumb levels the
              reference-style single line doesn't render well. */}
        <FieldCard label="Location Selection" required>
          <button
            type="button"
            onClick={() => setLocationOpen((v) => !v)}
            className="relative flex items-center rounded-lg bg-stone-100 px-4 h-12 w-full text-left"
          >
            <span className={selectedLocation ? "text-stone-900" : "text-stone-400"}>
              {selectedLocation ? selectedLocation.name : "Select locations..."}
            </span>
            <ChevronDown className="ml-auto w-4 h-4 text-stone-500" />
          </button>
          {locationOpen && (
            <div className="mt-2 rounded-lg border border-stone-200 bg-white overflow-hidden">
              <input
                type="text"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder="Search block or villa…"
                className="w-full px-3 py-2 text-sm border-b border-stone-100 outline-none"
                autoFocus
              />
              <div className="max-h-64 overflow-y-auto divide-y divide-stone-100">
                {activities === null ? (
                  <div className="px-3 py-4 text-xs text-stone-500">Loading…</div>
                ) : filteredLocations.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-stone-500">No matches.</div>
                ) : (
                  filteredLocations.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => {
                        setWbsNodeId(a.id);
                        setLocationOpen(false);
                        setLocationSearch("");
                      }}
                      className={`w-full text-left px-3 py-2 active:bg-stone-50 ${
                        wbsNodeId === a.id ? "bg-amber-50" : ""
                      }`}
                    >
                      <div className="text-sm font-medium text-stone-900">{a.name}</div>
                      {a.path.length > 1 && (
                        <div className="text-[10px] text-stone-500 mt-0.5">
                          {a.path.slice(0, -1).join(" / ")}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </FieldCard>

        {/* 5. Description — required, dashed-amber textarea */}
        <FieldCard label="Description" required>
          <DashedTextarea
            value={description}
            onChange={setDescription}
            placeholder="Enter Your Remark"
            rows={3}
          />
        </FieldCard>

        {/* 6. Reason For Hindrance — required, dashed-amber textarea */}
        <FieldCard label="Reason For Hindrance" required>
          <DashedTextarea
            value={reasonNote}
            onChange={setReasonNote}
            placeholder="Enter Your Remark"
            rows={3}
          />
        </FieldCard>

        {/* 7. From Date & Time — required */}
        <FieldCard label="From Date & Time" required>
          <DateTimeShell value={startAt} onChange={setStartAt} />
        </FieldCard>

        {/* 8. To Date & Time — required */}
        <FieldCard label="To Date & Time" required>
          <DateTimeShell value={endAt} onChange={setEndAt} />
        </FieldCard>

        {/* 9. Calculated Duration — derived, no input */}
        <FieldCard label={`Calculated Duration : ${durationLabel}`} inline />

        {/* 10. Cost Impact */}
        <FieldCard label="Cost Impact">
          <div className="relative flex items-center rounded-lg bg-stone-100 px-4 h-12">
            <span className="text-stone-500 mr-2">₹</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              value={costImpact}
              onChange={(e) => setCostImpact(e.target.value)}
              placeholder="Enter Amount"
              className="w-full bg-transparent outline-none text-stone-900 placeholder:text-stone-400"
            />
          </div>
        </FieldCard>

        {/* 11. Upload File/Photo */}
        <FieldCard
          label="Upload File/Photo"
          rightAdornment={
            <label className="w-9 h-9 rounded-md bg-stone-900 text-white flex items-center justify-center active:scale-[0.97]">
              <Camera className="w-4 h-4" />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  const merged = [...photos, ...files].slice(0, 4);
                  setPhotos(merged);
                  e.target.value = "";
                }}
              />
            </label>
          }
        >
          {photos.length === 0 ? (
            <div className="rounded-lg border border-stone-300 bg-white flex flex-col items-center justify-center py-10 text-stone-400">
              <div className="w-14 h-14 flex items-center justify-center rounded-md border border-stone-300 mb-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="m3 20 6-8 5 6 3-4 4 6" />
                  <line x1="3" y1="20" x2="21" y2="4" strokeWidth="2" />
                </svg>
              </div>
              <p className="text-sm">No image available</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((f, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setPhotos(photos.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    aria-label="Remove photo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </FieldCard>

        {loadError && (
          <p className="text-xs text-red-600">
            {loadError}. Some pickers may be empty — check your connection and retry.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-ink text-cream py-4 text-[16px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
        >
          {pending ? "Saving…" : "Save hindrance"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks — kept inside the file because they're specific to
// this form's card layout and would be dead weight in the shared /components.
// ---------------------------------------------------------------------------

function FieldCard({
  label,
  required,
  inline,
  rightAdornment,
  children,
}: {
  label: string;
  required?: boolean;
  /** true = label only, no control below (used for the derived duration row). */
  inline?: boolean;
  rightAdornment?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm border border-stone-100">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[15px] font-bold text-stone-900">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </div>
        {rightAdornment}
      </div>
      {!inline && children}
    </section>
  );
}

/** Fake-select shell — a real <select> layered on top for native picker UX.
 *  `placeholder` isn't rendered here (the layered <select> owns its own empty
 *  option); it exists for callers to document intent. */
function SelectShell({ children }: { children: React.ReactNode; placeholder: string }) {
  return (
    <div className="relative flex items-center rounded-lg bg-stone-100 px-4 h-12">
      {children}
      <ChevronDown className="ml-auto w-4 h-4 text-stone-500 pointer-events-none" />
    </div>
  );
}

function DashedTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-lg border-2 border-dashed border-amber-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-amber-400 resize-y"
    />
  );
}

function DateTimeShell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex items-center rounded-lg bg-stone-100 px-4 h-12">
      <span className="text-stone-900">{formatDatetimeLocal(value)}</span>
      <Calendar className="ml-auto w-4 h-4 text-stone-700 pointer-events-none" />
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date helpers — datetime-local <input> uses YYYY-MM-DDTHH:mm in LOCAL time.
// Do not confuse with ISO 8601 UTC.
// ---------------------------------------------------------------------------

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocal(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "17 Sep 2026 | 5:24 PM" — reference format. */
function formatDatetimeLocal(v: string): string {
  const d = parseDatetimeLocal(v);
  if (!d) return "—";
  const day = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} | ${time}`;
}
