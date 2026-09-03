"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  PERMIT_CATEGORIES,
  PERMIT_CATEGORY_LABELS,
  PERMIT_STATUS_LABELS,
  daysUntilExpiry,
  effectivePermitStatus,
  type PermitCategory,
  type PermitStatus,
} from "@/lib/permit";
import TrashButton from "./TrashButton";

export interface PermitRow {
  id: string;
  name: string;
  number: string | null;
  issuingAuthority: string;
  category: string;
  issuedDate: string;    // ISO
  expiryDate: string | null;
  storedStatus: string;
  renewalReminderDays: number;
  responsibleName: string | null;
  documentUrl: string | null;
  notes: string | null;
}

export interface PermitsManagerProps {
  projectId: string;
  permits: PermitRow[];
  users: Array<{ id: string; name: string }>;
  canManage: boolean;
}

const STATUS_STYLE: Record<PermitStatus, { bg: string; fg: string }> = {
  ACTIVE:         { bg: "#E4EFE8", fg: "#2E7D5B" },
  EXPIRING_SOON:  { bg: "#F7EAD5", fg: "#C77A2A" },
  EXPIRED:        { bg: "#F3DFDF", fg: "#B33A3A" },
  RENEWED:        { bg: "#E9F0F7", fg: "#1E4266" },
};

export default function PermitsManager({ projectId, permits, users, canManage }: PermitsManagerProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const today = new Date();
  const rows = useMemo(() => {
    return permits.map((p) => {
      const expiry = p.expiryDate ? new Date(p.expiryDate) : null;
      const eff = effectivePermitStatus({
        storedStatus: p.storedStatus as PermitStatus,
        expiryDate: expiry,
        renewalReminderDays: p.renewalReminderDays,
        today,
      });
      const daysLeft = daysUntilExpiry(expiry, today);
      return { ...p, effectiveStatus: eff, daysLeft };
    });
  // Constant per-render values; today changes each render but we accept that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permits]);

  // Group by effective status for the count chips.
  const counts: Record<PermitStatus, number> = { ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, RENEWED: 0 };
  for (const r of rows) counts[r.effectiveStatus]++;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap text-xs">
        <Chip label={`${counts.EXPIRED} Expired`} style={STATUS_STYLE.EXPIRED} />
        <Chip label={`${counts.EXPIRING_SOON} Expiring soon`} style={STATUS_STYLE.EXPIRING_SOON} />
        <Chip label={`${counts.ACTIVE} Active`} style={STATUS_STYLE.ACTIVE} />
        <Chip label={`${counts.RENEWED} Renewed`} style={STATUS_STYLE.RENEWED} />
      </div>

      {canManage && (
        <div>
          {creating ? (
            <PermitCreateForm
              projectId={projectId}
              users={users}
              onCancel={() => setCreating(false)}
              onDone={() => { setCreating(false); router.refresh(); }}
            />
          ) : (
            <button
              type="button"
              className="inline-flex items-center rounded-lg bg-stone-900 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-stone-800"
              onClick={() => setCreating(true)}
            >
              + Add permit
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-stone-500">
          No permits yet. Add the first one to start tracking renewals.
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Permit</th>
                <th className="text-left px-4 py-2 font-medium">Authority</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Expires</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Owner</th>
                {canManage && <th className="px-2 py-2 w-8" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-stone-100">
                  <td className="px-4 py-3 text-stone-900">
                    <div className="font-medium">{r.name}</div>
                    {r.number && <div className="text-xs text-stone-400 font-mono">{r.number}</div>}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{r.issuingAuthority}</td>
                  <td className="px-4 py-3 text-stone-600 text-xs">
                    {PERMIT_CATEGORY_LABELS[r.category as PermitCategory] ?? r.category}
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-xs font-mono whitespace-nowrap">
                    {r.issuedDate.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-xs font-mono whitespace-nowrap">
                    {r.expiryDate ? r.expiryDate.slice(0, 10) : <span className="italic">permanent</span>}
                    {r.daysLeft != null && r.daysLeft <= 30 && (
                      <span className={`block text-[10px] font-semibold ${r.daysLeft < 0 ? "text-red-700" : "text-orange-700"}`}>
                        {r.daysLeft < 0 ? `${Math.abs(r.daysLeft)}d overdue` : `${r.daysLeft}d left`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Chip label={PERMIT_STATUS_LABELS[r.effectiveStatus]} style={STATUS_STYLE[r.effectiveStatus]} />
                  </td>
                  <td className="px-4 py-3 text-stone-600 whitespace-nowrap">
                    {r.responsibleName ?? <span className="italic text-stone-400">—</span>}
                  </td>
                  {canManage && (
                    <td className="px-2 py-3 text-right">
                      {/* Server enforces admin-only; non-admin managers see 403. */}
                      <TrashButton
                        url={`/api/permits/${r.id}`}
                        kind="permit"
                        label={r.name}
                        onDeleted={() => router.refresh()}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Chip({ label, style }: { label: string; style: { bg: string; fg: string } }) {
  return (
    <span
      className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  );
}

function PermitCreateForm({
  projectId,
  users,
  onCancel,
  onDone,
}: {
  projectId: string;
  users: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [category, setCategory] = useState<PermitCategory>("BUILDING");
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [renewalReminderDays, setRenewalReminderDays] = useState(30);
  const [documentUrl, setDocumentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputCls = "w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/permits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, name, number: number || null, issuingAuthority, category,
          issuedDate, expiryDate: expiryDate || null,
          responsibleUserId: responsibleUserId || null,
          renewalReminderDays,
          documentUrl: documentUrl || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to add permit" }));
        throw new Error(body.error ?? "Failed to add permit");
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Permit name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="BBMP Building Permit" className={`${inputCls} mt-1`} required />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Permit number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="BBMP/2026/12345" className={`${inputCls} mt-1 font-mono`} />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Issuing authority</span>
          <input value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} placeholder="BBMP" className={`${inputCls} mt-1`} required />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as PermitCategory)} className={`${inputCls} mt-1`}>
            {PERMIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{PERMIT_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Issued</span>
          <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} className={`${inputCls} mt-1`} required />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Expires (blank = permanent)</span>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={`${inputCls} mt-1`} />
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Responsible person</span>
          <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">— unassigned —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Alert this many days before expiry</span>
          <input type="number" min={1} max={365} value={renewalReminderDays} onChange={(e) => setRenewalReminderDays(Number(e.target.value))} className={`${inputCls} mt-1`} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Document link (optional)</span>
        <input value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://..." className={`${inputCls} mt-1`} />
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} mt-1`} />
      </label>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={submitting} className="inline-flex items-center rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-50">
          {submitting ? "Saving..." : "Save permit"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-stone-200 bg-white text-stone-700 px-4 py-2 text-sm font-medium hover:bg-stone-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
