"use client";

import { useCallback, useEffect, useState } from "react";

type Drawing = {
  id: string;
  label: string;
  kind: string;
  imageUrl: string;
  isDefault: boolean;
  createdAt: string;
};

const LEGEND = [
  { name: "Plumbing", color: "#A855F7" },
  { name: "MS works", color: "#10B981" },
  { name: "Carpentry Work", color: "#F472B6" },
  { name: "Finishing", color: "#EC4899" },
  { name: "External Development", color: "#6366F1" },
];

export default function InteractiveDrawings({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [drawings, setDrawings] = useState<Drawing[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("LAYOUT");
  const [file, setFile] = useState<File | null>(null);
  const [isDefault, setIsDefault] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/drawings`, { cache: "no-store" });
    if (!res.ok) { setError(await res.text()); return; }
    const data = await res.json();
    setDrawings(data.drawings);
    if (!activeId && data.drawings.length > 0) {
      setActiveId(data.drawings.find((d: Drawing) => d.isDefault)?.id ?? data.drawings[0].id);
    }
  }, [projectId, activeId]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !label.trim()) {
      setError("File + label required");
      return;
    }
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("label", label.trim());
    fd.set("kind", kind);
    if (isDefault) fd.set("isDefault", "true");
    const res = await fetch(`/api/projects/${projectId}/drawings`, { method: "POST", body: fd });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Upload failed");
      return;
    }
    setLabel("");
    setFile(null);
    setShowUpload(false);
    load();
  }

  const active = drawings?.find((d) => d.id === activeId) ?? null;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Interactive Drawings</h2>
          {drawings && drawings.length > 0 && (
            <p className="text-xs text-stone-500 mt-0.5">Select Image</p>
          )}
        </div>
        {canManage && (
          <button
            onClick={() => setShowUpload((s) => !s)}
            className="text-xs rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-100"
          >
            {showUpload ? "Cancel" : "+ Upload drawing"}
          </button>
        )}
      </div>

      {showUpload && (
        <form
          onSubmit={handleUpload}
          className="mb-4 rounded-lg border border-stone-200 bg-stone-100 p-3 grid grid-cols-1 sm:grid-cols-4 gap-2"
        >
          <input
            required
            placeholder="Label (e.g. Layout)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="LAYOUT">Layout</option>
            <option value="360_IMAGE">360 Image</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            required
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded-full bg-stone-900 text-white text-xs font-medium px-4 py-2 disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <label className="flex items-center gap-2 text-xs text-stone-700 sm:col-span-4">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Make default
          </label>
        </form>
      )}

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {drawings === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : drawings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center">
          <p className="text-sm text-stone-500">No drawings uploaded yet.</p>
          {canManage && <p className="text-xs text-stone-400 mt-1">Click &quot;+ Upload drawing&quot; to add one.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
          <div>
            <div className="flex flex-wrap gap-2 mb-2">
              {drawings.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setActiveId(d.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md ${
                    activeId === d.id ? "bg-amber-400 text-stone-900" : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {active && (
              <div className="rounded-lg border border-stone-200 overflow-hidden bg-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={active.imageUrl} alt={active.label} className="w-full h-auto block" />
              </div>
            )}
          </div>
          <aside className="space-y-2 lg:w-44">
            <h3 className="text-[10px] font-semibold tracking-wider uppercase text-stone-500">Layout Legends</h3>
            {LEGEND.map((l) => (
              <div
                key={l.name}
                className="text-xs font-semibold text-white px-3 py-2 rounded-md text-center"
                style={{ backgroundColor: l.color }}
              >
                {l.name}
              </div>
            ))}
          </aside>
        </div>
      )}
    </section>
  );
}
