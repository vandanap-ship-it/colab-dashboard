"use client";

import { useState } from "react";

type ContractorRow = {
  id: string;
  name: string;
  category: string;
  showInPickers: boolean;
  _count: {
    progressEntries: number;
    manpowerEntries: number;
    workPermits: number;
    safetyInductions: number;
    inspections: number;
    wbsNodes: number;
  };
};

/**
 * One row per contractor with a visible toggle switch (showInPickers).
 * Flipping the switch calls PATCH /api/projects/:id/contractors/:cid.
 * The row updates optimistically; on API failure we revert and show a
 * terse error strip at the top.
 *
 * `_count` chips give the admin a quick sense of how embedded a
 * contractor is before hiding them, so a vendor with 400 progress rows
 * doesn't accidentally disappear from someone's expectations.
 */
export default function ContractorsVisibilityConsole({
  projectId,
  initial,
}: {
  projectId: string;
  initial: ContractorRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(cid: string, next: boolean) {
    setError(null);
    setBusyId(cid);
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === cid ? { ...r, showInPickers: next } : r)));
    try {
      const res = await fetch(
        `/api/projects/${projectId}/contractors/${cid}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showInPickers: next }),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
    } catch (e) {
      setRows(before);
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const visible = rows.filter((r) => r.showInPickers);
  const hidden = rows.filter((r) => !r.showInPickers);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-2">
          {error}
        </div>
      )}

      <Section
        title="Shown in mobile pickers"
        subtitle={`${visible.length} of ${rows.length} total`}
        rows={visible}
        onToggle={toggle}
        busyId={busyId}
        emptyText="No contractors are visible. The mobile pickers will be empty."
      />

      <Section
        title="Hidden from pickers"
        subtitle={`${hidden.length} of ${rows.length} total`}
        rows={hidden}
        onToggle={toggle}
        busyId={busyId}
        emptyText="None hidden yet. Toggle a contractor above to move it here."
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  onToggle,
  busyId,
  emptyText,
}: {
  title: string;
  subtitle: string;
  rows: ContractorRow[];
  onToggle: (id: string, next: boolean) => void;
  busyId: string | null;
  emptyText: string;
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
          {title}
        </h2>
        <span className="text-xs text-stone-400">{subtitle}</span>
      </header>
      {rows.length === 0 ? (
        <p className="text-xs text-stone-400 italic px-1">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-stone-900 truncate">{r.name}</div>
                <div className="text-[11px] text-stone-500 mt-0.5">
                  <span className="mr-3">{r.category || "No category"}</span>
                  <CountChip label="progress" n={r._count.progressEntries} />
                  <CountChip label="labour" n={r._count.manpowerEntries} />
                  <CountChip label="permits" n={r._count.workPermits} />
                  <CountChip label="inductions" n={r._count.safetyInductions} />
                  <CountChip label="WIRs" n={r._count.inspections} />
                  <CountChip label="activities" n={r._count.wbsNodes} />
                </div>
              </div>
              <Toggle
                on={r.showInPickers}
                disabled={busyId === r.id}
                onChange={(next) => onToggle(r.id, next)}
                label={`${r.showInPickers ? "Hide" : "Show"} ${r.name} in pickers`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CountChip({ label, n }: { label: string; n: number }) {
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 mr-2 text-[11px] text-stone-500">
      <span className="tabular-nums font-medium text-stone-700">{n}</span>
      <span className="text-stone-400">{label}</span>
    </span>
  );
}

function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        on ? "bg-ferrous-500" : "bg-stone-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
