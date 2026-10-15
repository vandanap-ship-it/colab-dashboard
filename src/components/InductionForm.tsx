"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, X, Loader2, ShieldCheck, PenLine } from "lucide-react";
import { istDayString } from "@/lib/istDay";

/**
 * Mobile Safety Induction raise form. "Tall" vertical layout per
 * Shraddha 2026-10-01 — single column, each field stacked. Covers the
 * core 10 fields the Colab list card shows (worker photo + name +
 * trade + contractor + gender + age + DOB + contact + aadhaar + 3
 * photos). Long-tail HR fields (father name, bank account, etc.)
 * deferred to Phase 2 (see colab_safety_induction_spec).
 *
 * Four photo slots backed by <input type="file" accept="image/*"> (camera
 * or gallery — the phone offers both): the primary worker profile picture plus
 * Aadhaar front, Aadhaar back, and the worker's signature on paper.
 * Each uploads to /api/upload with a dedicated scope so the server
 * can reason about provenance before accepting the URL.
 *
 * Submission is idempotent via a client-generated key reused across
 * network retries (offline-queue safe, same pattern as every other
 * mobile form).
 */

type Contractor = { id: string; name: string; category: string | null };

type Photo = { file: File | null; previewUrl: string | null; uploadedUrl: string | null };
function emptyPhoto(): Photo {
  return { file: null, previewUrl: null, uploadedUrl: null };
}

export default function InductionForm({
  projectId,
  projectName,
  contractors,
}: {
  projectId: string;
  projectName: string;
  contractors: Contractor[];
}) {
  const today = istDayString();

  const [workerName, setWorkerName] = useState("");
  const [trade, setTrade] = useState("");
  const [contractorId, setContractorId] = useState<string>("");
  const [gender, setGender] = useState<"Male" | "Female" | "Other" | "">("");
  const [age, setAge] = useState<string>("");
  const [dob, setDob] = useState<string>("");
  const [contactNumber, setContactNumber] = useState("");
  const [aadhaarNumber, setAadhaarNumber] = useState("");
  const [inductionDate, setInductionDate] = useState(today);

  const [workerPhoto, setWorkerPhoto] = useState<Photo>(emptyPhoto());
  const [aadhaarFront, setAadhaarFront] = useState<Photo>(emptyPhoto());
  const [aadhaarBack, setAadhaarBack] = useState<Photo>(emptyPhoto());
  const [signature, setSignature] = useState<Photo>(emptyPhoto());

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | { workerName: string; displayId: string }>(null);

  async function uploadOne(photo: Photo, slot: string): Promise<string | null> {
    if (!photo.file) return photo.uploadedUrl;
    const fd = new FormData();
    fd.set("scope", `induction-${slot}-${projectId}`);
    fd.append("file", photo.file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? `Photo upload failed (${slot})`);
    }
    const { urls } = await res.json();
    return urls?.[0] ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    // Hard requires on the form side. Aadhaar is optional at the DB
    // layer so a mid-signal save doesn't 500, but the UI pushes for
    // the complete profile Shraddha asked for.
    if (workerName.trim().length < 2) {
      setError("Enter the worker's full name.");
      return;
    }
    if (trade.trim().length < 2) {
      setError("Enter the worker's trade (e.g. Carpenter, Mason).");
      return;
    }
    if (!gender) {
      setError("Pick a gender.");
      return;
    }
    if (!workerPhoto.file && !workerPhoto.uploadedUrl) {
      setError("Capture a worker profile photo — mandatory for the induction card.");
      return;
    }
    if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) {
      setError("Aadhaar must be 12 digits.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const [workerUrl, aadhaarFrontUrl, aadhaarBackUrl, signatureUrl] = await Promise.all([
        uploadOne(workerPhoto, "worker"),
        uploadOne(aadhaarFront, "aadhaar-front"),
        uploadOne(aadhaarBack, "aadhaar-back"),
        uploadOne(signature, "signature"),
      ]);

      const payload = {
        idempotencyKey: crypto.randomUUID(),
        projectId,
        workerName: workerName.trim(),
        workerPhotoUrl: workerUrl ?? undefined,
        trade: trade.trim(),
        contractorId: contractorId || undefined,
        gender,
        age: age ? Number(age) : undefined,
        dob: dob || undefined,
        contactNumber: contactNumber.trim() || undefined,
        aadhaarNumber: aadhaarNumber || undefined,
        aadhaarFrontUrl: aadhaarFrontUrl ?? undefined,
        aadhaarBackUrl: aadhaarBackUrl ?? undefined,
        signatureUrl: signatureUrl ?? undefined,
        inductionDate: inductionDate || undefined,
      };

      const res = await fetch("/api/safety-inductions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Save failed (${res.status})`);
        setPending(false);
        return;
      }
      const { induction } = await res.json();
      setSaved({ workerName: induction.workerName, displayId: induction.displayId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPending(false);
    }
  }

  function resetForNextWorker() {
    setWorkerName("");
    setTrade("");
    setGender("");
    setAge("");
    setDob("");
    setContactNumber("");
    setAadhaarNumber("");
    setInductionDate(today);
    setWorkerPhoto(emptyPhoto());
    setAadhaarFront(emptyPhoto());
    setAadhaarBack(emptyPhoto());
    setSignature(emptyPhoto());
    setError(null);
    setSaved(null);
    setPending(false);
    // Contractor stays set — the safety officer typically inducts a
    // batch of workers from the same contractor in one visit.
  }

  if (saved) {
    return (
      <div className="flex-1 flex flex-col bg-ivory">
        <header className="px-4 pt-4 pb-3 border-b border-sandstone-100">
          <h1 className="font-serif text-[22px] text-ink">Induction raised</h1>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-4 text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
            <p className="text-[15px] font-semibold text-emerald-900">
              {saved.workerName} · {saved.displayId}
            </p>
            <p className="text-[12px] text-emerald-800 mt-1">
              Girish R has been notified. The worker can start once he approves.
            </p>
          </div>
          <button
            type="button"
            onClick={resetForNextWorker}
            className="w-full rounded-xl bg-ink text-white py-3.5 text-base font-medium"
          >
            Induct another worker
            <span className="block text-[12px] text-stone-300 mt-0.5">
              Same contractor, fresh form
            </span>
          </button>
          <Link
            href={`/mobile/${projectId}/induction?tab=me`}
            className="block w-full rounded-xl bg-white border border-stone-200 text-stone-900 py-3.5 text-base font-medium text-center"
          >
            Back to my inductions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col bg-ivory">
      <header className="px-4 pt-4 pb-3 border-b border-sandstone-100 flex items-center gap-3 sticky top-0 bg-ivory z-10">
        <Link
          href={`/mobile/${projectId}/induction?tab=me`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sandstone-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[20px] leading-tight text-ink tracking-tight">
            New safety induction
          </h1>
          <p className="text-[12px] text-ink-3 truncate">{projectName}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Worker photo — top of the form, big tap target. Opens the
            phone's chooser: take a photo or pick from the gallery. */}
        <section>
          <label className="block text-[13px] font-semibold text-ink mb-2">
            Worker photo <span className="text-red-500">*</span>
          </label>
          <PhotoCapture
            photo={workerPhoto}
            setPhoto={setWorkerPhoto}
            shape="circle"
            size="lg"
          />
          <p className="text-[11px] text-ink-3 mt-1">
            Face-forward, taken at the gate pre-induction.
          </p>
        </section>

        <TextInput
          label="Worker name"
          required
          value={workerName}
          onChange={setWorkerName}
          placeholder="e.g. Lakshman Rabidas"
          autoComplete="off"
        />

        <TextInput
          label="Trade"
          required
          value={trade}
          onChange={setTrade}
          placeholder="e.g. Carpenter, Mason, Helper"
          autoComplete="off"
        />

        <section>
          <label className="block text-[13px] font-semibold text-ink mb-1">Contractor</label>
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px]"
          >
            <option value="">Pick a contractor…</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.category ? ` · ${c.category}` : ""}
              </option>
            ))}
          </select>
        </section>

        <section>
          <label className="block text-[13px] font-semibold text-ink mb-1">
            Gender <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["Male", "Female", "Other"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={
                  "rounded-lg py-2 text-[14px] font-semibold border " +
                  (gender === g
                    ? "bg-ferrous-500 text-white border-ferrous-500"
                    : "bg-white text-ink-2 border-stone-300")
                }
              >
                {g}
              </button>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Age"
            type="number"
            value={age}
            onChange={setAge}
            placeholder="30"
            inputMode="numeric"
            min={16}
            max={99}
          />
          <section>
            <label className="block text-[13px] font-semibold text-ink mb-1">Date of birth</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={today}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
            />
          </section>
        </div>

        <TextInput
          label="Contact number"
          value={contactNumber}
          onChange={setContactNumber}
          placeholder="+91 90000 00000"
          inputMode="tel"
          autoComplete="off"
        />

        <TextInput
          label="Aadhaar number"
          value={aadhaarNumber}
          onChange={(v) => setAadhaarNumber(v.replace(/\D/g, "").slice(0, 12))}
          placeholder="12 digits"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
        />

        {/* Supporting photos — Aadhaar front, Aadhaar back.
            Optional at the DB level but Vandana wants them captured
            during the induction visit; the UI treats them as expected
            but doesn't block save. */}
        <section>
          <label className="block text-[13px] font-semibold text-ink mb-2">
            Supporting photos
          </label>
          <div className="grid grid-cols-2 gap-2">
            <PhotoCapture photo={aadhaarFront} setPhoto={setAadhaarFront} shape="square" size="sm" caption="Aadhaar front" />
            <PhotoCapture photo={aadhaarBack} setPhoto={setAadhaarBack} shape="square" size="sm" caption="Aadhaar back" />
          </div>
        </section>

        {/* Signature — Vandana 2026-10-15: Colab lets the worker sign
            on-screen. Primary input is the pad below; a fallback
            "Upload photo of signed paper" tile handles the case where
            an older worker can't sign on the device. Both paths write
            to the same `signature` Photo state, uploaded with the
            induction-signature scope. */}
        <section>
          <label className="block text-[13px] font-semibold text-ink mb-2">
            Signature
          </label>
          <SignatureCapture photo={signature} setPhoto={setSignature} />
        </section>

        <section>
          <label className="block text-[13px] font-semibold text-ink mb-1">Induction date</label>
          <input
            type="date"
            value={inductionDate}
            onChange={(e) => setInductionDate(e.target.value)}
            max={today}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px]"
          />
          <p className="text-[11px] text-ink-3 mt-1">
            Expires 12 months from this date. The system flips it automatically.
          </p>
        </section>

        {error && (
          <p className="text-[13px] text-red-700 bg-red-50 ring-1 ring-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <div
        className="border-t border-stone-200 bg-white/95 backdrop-blur-md p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ferrous-500 text-white text-base font-semibold py-3.5 disabled:opacity-60"
        >
          {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
          {pending ? "Saving…" : "Submit for approval"}
        </button>
      </div>
    </form>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  inputMode,
  autoComplete,
  min,
  max,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  inputMode?: "numeric" | "tel" | "text" | "decimal";
  autoComplete?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}) {
  return (
    <section>
      <label className="block text-[13px] font-semibold text-ink mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        min={min}
        max={max}
        maxLength={maxLength}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px]"
      />
    </section>
  );
}

function PhotoCapture({
  photo,
  setPhoto,
  shape,
  size,
  caption,
}: {
  photo: Photo;
  setPhoto: (p: Photo) => void;
  shape: "circle" | "square";
  size: "lg" | "sm";
  caption?: string;
}) {
  const sizeCls = size === "lg" ? "w-32 h-32" : "w-full aspect-square";
  const shapeCls = shape === "circle" ? "rounded-full" : "rounded-lg";

  if (photo.previewUrl) {
    return (
      <div className="relative inline-block">
        <div className={`${sizeCls} ${shapeCls} overflow-hidden bg-stone-100 border-2 border-sandstone-200`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt="" className="w-full h-full object-cover" />
        </div>
        <button
          type="button"
          onClick={() => {
            URL.revokeObjectURL(photo.previewUrl!);
            setPhoto(emptyPhoto());
          }}
          className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-ink text-white flex items-center justify-center shadow-md"
          aria-label="Remove"
        >
          <X className="w-4 h-4" />
        </button>
        {caption && <p className="text-[10px] text-stone-500 mt-1 text-center">{caption}</p>}
      </div>
    );
  }

  return (
    <label
      className={`${sizeCls} ${shapeCls} bg-sandstone-50 border-2 border-dashed border-sandstone-200 flex flex-col items-center justify-center text-stone-500 cursor-pointer hover:bg-sandstone-100`}
    >
      <Camera className={size === "lg" ? "w-8 h-8" : "w-5 h-5"} />
      {caption && <p className={`text-[${size === "lg" ? "11" : "10"}px] mt-1`}>{caption}</p>}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setPhoto({
              file: f,
              previewUrl: URL.createObjectURL(f),
              uploadedUrl: null,
            });
          }
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

/**
 * On-screen signature pad (Vandana 2026-10-15, Colab parity). The
 * worker signs with a finger or stylus directly on the device; on
 * Save, the canvas is rendered to a PNG File and dropped into the
 * same `signature` Photo state the paper-photo flow used, so the
 * upload path on submit is unchanged.
 *
 * A fallback "Upload a photo of a signed paper" tile sits below the
 * pad for workers who can't sign on-screen (older phones, big thumbs,
 * accessibility). Either path overwrites the same state — last one
 * saved wins. Once the signature exists, we render the preview with
 * a remove X and the capture area collapses.
 */
function SignatureCapture({
  photo,
  setPhoto,
}: {
  photo: Photo;
  setPhoto: (p: Photo) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // Set canvas backing-store resolution to match its CSS size * DPR
  // so strokes stay crisp on retina phones. Runs on mount; no
  // dependency on content so it won't re-run and wipe strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#161926";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawingRef.current = true;
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = pointerPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }
  function handlePointerUp() {
    drawingRef.current = false;
  }

  function clearPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setHasInk(false);
  }

  function saveSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Flatten the transparent stroke onto a white background so the
    // uploaded PNG renders well on light + dark previews later. Copy
    // via an offscreen canvas at the backing resolution.
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, 0);
    tmp.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
      const previewUrl = URL.createObjectURL(blob);
      if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      setPhoto({ file, previewUrl, uploadedUrl: null });
    }, "image/png");
  }

  // Already captured → preview card with remove X and a "Re-sign" link.
  if (photo.previewUrl) {
    return (
      <div className="rounded-lg border border-sandstone-200 bg-white p-3 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.previewUrl}
          alt="Signature"
          className="w-28 h-16 object-contain border border-stone-200 rounded bg-white"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-ink">Signature captured.</p>
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(photo.previewUrl!);
              setPhoto(emptyPhoto());
            }}
            className="text-[11px] text-ferrous-600 hover:text-ferrous-700 font-medium"
          >
            Clear and re-sign
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sandstone-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <PenLine className="w-3.5 h-3.5" />
        <span>Sign with finger or stylus below.</span>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-32 bg-sandstone-50 border border-dashed border-stone-300 rounded cursor-crosshair"
        // touchAction:none → canvas never scrolls while signing.
        style={{ touchAction: "none" }}
        aria-label="Signature canvas"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={clearPad}
          disabled={!hasInk}
          className="rounded-md border border-stone-300 bg-white text-ink text-sm font-semibold py-2 disabled:opacity-50"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={saveSignature}
          disabled={!hasInk}
          className="rounded-md bg-ink text-white text-sm font-semibold py-2 disabled:opacity-50"
        >
          Save signature
        </button>
      </div>
      {/* Paper fallback — same uploader as every other photo. For an
          older worker who can't sign on-screen, the raiser takes a
          photo of a signed sheet instead. */}
      <label className="block w-full rounded-md border border-dashed border-stone-300 bg-white text-ink-3 text-[12px] font-medium py-2 text-center cursor-pointer hover:bg-sandstone-50">
        <span className="inline-flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" />
          Or upload a photo of a signed paper
        </span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
              setPhoto({
                file: f,
                previewUrl: URL.createObjectURL(f),
                uploadedUrl: null,
              });
            }
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
