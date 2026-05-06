"use client";

import { useCallback, useEffect, useState } from "react";

type Contractor = {
  id: string;
  name: string;
  category: string;
  active: boolean;
  project: { id: string; name: string };
};

type Project = { id: string; name: string };

export default function ContractorsAdmin() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [contractors, setContractors] = useState<Contractor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const [projRes, conRes] = await Promise.all([
      fetch("/api/projects", { cache: "no-store" }),
      fetch("/api/admin/contractors", { cache: "no-store" }),
    ]);
    if (!projRes.ok || !conRes.ok) {
      setError("Failed to load");
      return;
    }
    const projData = await projRes.json();
    const conData = await conRes.json();
    setProjects(projData.projects);
    setContractors(conData.contractors);
    if (!projectId && projData.projects.length > 0) {
      setProjectId(projData.projects[0].id);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/admin/contractors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name, category }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    setName("");
    setCategory("");
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Contractors</h1>
        <p className="text-sm text-stone-500 mt-1">Per-project contractor directory used in progress entries.</p>
      </div>

      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-stone-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-4 gap-3"
      >
        <select
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          required
          placeholder="Contractor name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="Category (Plumbing, MS Fabrication…)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-stone-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-60"
        >
          {pending ? "Adding…" : "+ Add contractor"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {contractors === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : contractors.length === 0 ? (
        <p className="text-sm text-stone-500">No contractors yet.</p>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ivory text-stone-500 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {contractors.map((c) => (
                <tr key={c.id} className="border-t border-stone-100">
                  <td className="px-4 py-2 text-stone-500">{c.project.name}</td>
                  <td className="px-4 py-2">{c.category}</td>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        c.active
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-stone-200 text-stone-700"
                      }`}
                    >
                      {c.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
