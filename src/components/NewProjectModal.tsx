"use client";

import { useRef, useState } from "react";
import { Building2, Loader2, Upload, X } from "lucide-react";
import { PROJECT_TYPES } from "@/lib/projectTypes";

export default function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("PLANNING");
  const [projectType, setProjectType] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("scope", "project-logo");
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Logo upload failed (${res.status})`);
        return;
      }
      const data = await res.json();
      const url: string | undefined = data.urls?.[0];
      if (!url) {
        setError("Logo uploaded but no URL returned.");
        return;
      }
      setLogoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        code: code || undefined,
        status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        address: address || undefined,
        projectType: projectType || undefined,
        logoUrl: logoUrl || undefined,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create");
      return;
    }
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ivory/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-white rounded-xl border border-stone-200 p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-stone-900">New project</h2>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none" aria-label="Close">×</button>
        </div>

        {/* Logo + Name row */}
        <div className="flex items-start gap-3">
          <LogoPicker
            logoUrl={logoUrl}
            uploading={logoUploading}
            onPick={(f) => uploadLogo(f)}
            onClear={() => setLogoUrl(null)}
            inputRef={logoInputRef}
          />
          <div className="flex-1 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-stone-700">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Amanvana"
                className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-stone-700">Code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="AMV"
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm uppercase"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-stone-700">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="PLANNING">Planning</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Project type</span>
          <select
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Start date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">End date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-full border border-stone-300 text-sm px-4 py-2 hover:bg-ivory">Cancel</button>
          <button type="submit" disabled={pending || logoUploading} className="rounded-full bg-stone-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-60">
            {pending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LogoPicker({
  logoUrl,
  uploading,
  onPick,
  onClear,
  inputRef,
}: {
  logoUrl: string | null;
  uploading: boolean;
  onPick: (f: File) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex-shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-20 h-20 rounded-lg border-2 border-dashed border-stone-300 bg-stone-50 flex flex-col items-center justify-center gap-1 hover:border-stone-500 transition-colors disabled:opacity-60"
        aria-label={logoUrl ? "Replace logo" : "Upload logo"}
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
        ) : logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo preview" className="w-full h-full object-cover rounded-md" />
        ) : (
          <>
            <Building2 className="w-5 h-5 text-stone-400" />
            <span className="text-[9px] font-semibold text-stone-500 uppercase tracking-wider">Logo</span>
          </>
        )}
      </button>
      {logoUrl && !uploading && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 text-[10px] text-stone-500 hover:text-red-600 flex items-center gap-0.5"
        >
          <X size={10} /> Remove
        </button>
      )}
      {!logoUrl && !uploading && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1 text-[10px] text-stone-500 hover:text-stone-900 flex items-center gap-0.5"
        >
          <Upload size={10} /> Upload
        </button>
      )}
    </div>
  );
}
