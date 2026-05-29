"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Send, Check, X, Banknote, RotateCcw, Download } from "lucide-react";
import {
  BILL_LINE_TYPES,
  billsToCsv,
  computeBillTotals,
  normalizeLine,
  summariseBills,
  type BillLineType,
} from "@/lib/billing";

type Contractor = { id: string; name: string };
type Person = { id: string; name: string } | null;

type BillLine = {
  id?: string;
  type: BillLineType;
  description: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
};

type Bill = {
  id: string;
  title: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID";
  notes: string | null;
  taxPercent: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  rejectionReason: string | null;
  contractor: Contractor;
  preparedBy: Person;
  approvedBy: Person;
  lineItems: BillLine[];
  subtotal: number;
  tax: number;
  total: number;
};

const TYPE_LABEL: Record<BillLineType, string> = {
  ITEM_RATE: "Item rate × qty",
  LABOUR: "Labour × rate",
  LUMP_SUM: "Lump sum",
};

const STATUS_STYLE: Record<Bill["status"], string> = {
  DRAFT: "bg-stone-100 text-stone-600",
  SUBMITTED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  PAID: "bg-blue-100 text-blue-700",
};

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

type FormState = {
  contractorId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  taxPercent: string;
  notes: string;
  lines: BillLine[];
};

function blankLine(): BillLine {
  return { type: "LUMP_SUM", description: "", quantity: null, unit: null, rate: null, amount: 0 };
}

export default function BillsManager({
  projectId,
  contractors,
  canPrepare,
  canApprove,
}: {
  projectId: string;
  contractors: Contractor[];
  canPrepare: boolean;
  canApprove: boolean;
}) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Bill | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | Bill["status"]>("ALL");
  const [contractorFilter, setContractorFilter] = useState<"ALL" | string>("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`/api/bills?projectId=${projectId}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setBills(d.bills ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Summary is over ALL bills (project overview); the filters only narrow the list.
  const summary = useMemo(() => summariseBills(bills ?? []), [bills]);
  const filtered = useMemo(() => {
    if (!bills) return [];
    return bills.filter(
      (b) =>
        (statusFilter === "ALL" || b.status === statusFilter) &&
        (contractorFilter === "ALL" || b.contractor.id === contractorFilter),
    );
  }, [bills, statusFilter, contractorFilter]);

  function downloadCsv() {
    const csv = billsToCsv(
      filtered.map((b) => ({
        title: b.title,
        contractorName: b.contractor.name,
        status: b.status,
        periodStart: b.periodStart ? b.periodStart.slice(0, 10) : null,
        periodEnd: b.periodEnd ? b.periodEnd.slice(0, 10) : null,
        subtotal: b.subtotal,
        tax: b.tax,
        total: b.total,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sub-contractor-bills.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function changeStatus(bill: Bill, status: Bill["status"], rejectionReason?: string) {
    setBusyId(bill.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/bills/${bill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error ?? `Action failed (${res.status})`);
      } else {
        reload();
      }
    } catch {
      setActionError("Network error. Please retry.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(bill: Bill) {
    if (!confirm(`Move bill "${bill.title}" to trash?`)) return;
    setBusyId(bill.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/bills/${bill.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setActionError(data?.error ?? `Delete failed (${res.status})`);
      } else {
        reload();
      }
    } catch {
      setActionError("Network error. Please retry.");
    } finally {
      setBusyId(null);
    }
  }

  function approveOrReject(bill: Bill, approve: boolean) {
    if (approve) return changeStatus(bill, "APPROVED");
    const reason = prompt("Reason for rejection (optional):") ?? "";
    return changeStatus(bill, "REJECTED", reason);
  }

  if (editing) {
    return (
      <BillEditor
        projectId={projectId}
        contractors={contractors}
        bill={editing === "new" ? null : editing}
        onDone={() => {
          setEditing(null);
          reload();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Bills</h2>
        {canPrepare && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-stone-800"
          >
            <Plus className="w-4 h-4" />
            New bill
          </button>
        )}
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {loadError ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-sm text-stone-600">Couldn&apos;t load bills.</p>
          <button type="button" onClick={reload} className="mt-2 text-sm font-medium text-stone-900 underline">
            Retry
          </button>
        </div>
      ) : !bills ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : bills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">No bills yet.</p>
          {canPrepare && (
            <button type="button" onClick={() => setEditing("new")} className="mt-2 text-sm font-medium text-amber-600">
              Prepare the first bill
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"] as const).map((s) => {
              const stat = summary.byStatus[s];
              if (!stat) return null;
              return (
                <div key={s} className={`rounded-lg px-3 py-2 ${STATUS_STYLE[s]}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider">{s}</div>
                  <div className="text-sm font-semibold tabular-nums">{inr(stat.total)}</div>
                  <div className="text-[10px] opacity-70">
                    {stat.count} bill{stat.count === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
            <div className="rounded-lg px-3 py-2 bg-stone-900 text-white ml-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wider">Total</div>
              <div className="text-sm font-semibold tabular-nums">{inr(summary.grandTotal)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="ALL">All statuses</option>
                {(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"] as const).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={contractorFilter}
                onChange={(e) => setContractorFilter(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="ALL">All contractors</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
            >
              <Download className="w-4 h-4 text-stone-400" />
              CSV
            </button>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-stone-500">No bills match the current filter.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((bill) => (
            <li key={bill.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-stone-900">{bill.title}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_STYLE[bill.status]}`}>
                      {bill.status}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {bill.contractor.name}
                    {bill.periodStart || bill.periodEnd ? ` · ${fmtDate(bill.periodStart)} → ${fmtDate(bill.periodEnd)}` : ""}
                    {bill.preparedBy ? ` · prepared by ${bill.preparedBy.name}` : ""}
                  </p>
                  {bill.status === "REJECTED" && bill.rejectionReason && (
                    <p className="text-xs text-red-600 mt-1">Rejected: {bill.rejectionReason}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-stone-900">{inr(bill.total)}</div>
                  {bill.tax > 0 && (
                    <div className="text-[11px] text-stone-400">
                      {inr(bill.subtotal)} + {inr(bill.tax)} tax
                    </div>
                  )}
                </div>
              </div>

              {bill.lineItems.length > 0 && (
                <ul className="mt-3 border-t border-stone-100 pt-2 space-y-1">
                  {bill.lineItems.map((l, i) => (
                    <li key={l.id ?? i} className="flex justify-between text-xs text-stone-600">
                      <span className="truncate">
                        {l.description || TYPE_LABEL[l.type]}
                        {l.type !== "LUMP_SUM" && l.quantity != null && l.rate != null
                          ? ` (${l.quantity}${l.unit ? " " + l.unit : ""} × ${inr(l.rate)})`
                          : ""}
                      </span>
                      <span className="tabular-nums">{inr(l.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {canPrepare && (bill.status === "DRAFT" || bill.status === "REJECTED") && (
                  <ActionBtn onClick={() => setEditing(bill)} disabled={busyId === bill.id} icon={<Pencil className="w-3.5 h-3.5" />}>
                    Edit
                  </ActionBtn>
                )}
                {canPrepare && bill.status === "DRAFT" && (
                  <ActionBtn onClick={() => changeStatus(bill, "SUBMITTED")} disabled={busyId === bill.id} icon={<Send className="w-3.5 h-3.5" />}>
                    Submit for approval
                  </ActionBtn>
                )}
                {canPrepare && bill.status === "REJECTED" && (
                  <ActionBtn onClick={() => changeStatus(bill, "DRAFT")} disabled={busyId === bill.id} icon={<RotateCcw className="w-3.5 h-3.5" />}>
                    Reopen
                  </ActionBtn>
                )}
                {canApprove && bill.status === "SUBMITTED" && (
                  <>
                    <ActionBtn onClick={() => approveOrReject(bill, true)} disabled={busyId === bill.id} tone="approve" icon={<Check className="w-3.5 h-3.5" />}>
                      Approve
                    </ActionBtn>
                    <ActionBtn onClick={() => approveOrReject(bill, false)} disabled={busyId === bill.id} tone="reject" icon={<X className="w-3.5 h-3.5" />}>
                      Reject
                    </ActionBtn>
                  </>
                )}
                {canApprove && bill.status === "APPROVED" && (
                  <ActionBtn onClick={() => changeStatus(bill, "PAID")} disabled={busyId === bill.id} tone="approve" icon={<Banknote className="w-3.5 h-3.5" />}>
                    Mark paid
                  </ActionBtn>
                )}
                {canPrepare && (bill.status === "DRAFT" || bill.status === "REJECTED") && (
                  <ActionBtn onClick={() => remove(bill)} disabled={busyId === bill.id} tone="reject" icon={<Trash2 className="w-3.5 h-3.5" />}>
                    Delete
                  </ActionBtn>
                )}
              </div>
            </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ActionBtn({
  onClick,
  disabled,
  icon,
  children,
  tone = "neutral",
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "neutral" | "approve" | "reject";
}) {
  const tones = {
    neutral: "border-stone-200 text-stone-700 hover:bg-stone-50",
    approve: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    reject: "border-red-200 text-red-600 hover:bg-red-50",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${tones[tone]}`}
    >
      {icon}
      {children}
    </button>
  );
}

function BillEditor({
  projectId,
  contractors,
  bill,
  onDone,
  onCancel,
}: {
  projectId: string;
  contractors: Contractor[];
  bill: Bill | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    contractorId: bill?.contractor.id ?? contractors[0]?.id ?? "",
    title: bill?.title ?? "",
    periodStart: bill?.periodStart ? bill.periodStart.slice(0, 10) : "",
    periodEnd: bill?.periodEnd ? bill.periodEnd.slice(0, 10) : "",
    taxPercent: bill?.taxPercent != null ? String(bill.taxPercent) : "",
    notes: bill?.notes ?? "",
    lines: bill?.lineItems.length ? bill.lineItems.map((l) => ({ ...l })) : [blankLine()],
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }
  function patchLine(i: number, p: Partial<BillLine>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) }));
  }
  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }));
  }
  function removeLine(i: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  }

  // Live preview using the SAME normalization the server applies.
  const preview = useMemo(() => {
    const normalized = form.lines.map((l, i) => normalizeLine(l, i));
    const taxNum = Number(form.taxPercent);
    const tax = isFinite(taxNum) && taxNum > 0 ? taxNum : null;
    return { normalized, ...computeBillTotals(normalized.map((l) => l.amount), tax) };
  }, [form.lines, form.taxPercent]);

  async function save() {
    if (form.title.trim().length < 3) {
      setError("Title must be at least 3 characters.");
      return;
    }
    if (!form.contractorId) {
      setError("Select a contractor.");
      return;
    }
    setPending(true);
    setError(null);
    const payload = {
      projectId,
      contractorId: form.contractorId,
      title: form.title.trim(),
      periodStart: form.periodStart || undefined,
      periodEnd: form.periodEnd || undefined,
      notes: form.notes,
      taxPercent: form.taxPercent === "" ? undefined : Number(form.taxPercent),
      lines: form.lines,
      idempotencyKey: bill ? undefined : crypto.randomUUID(),
    };
    try {
      const res = bill
        ? await fetch(`/api/bills/${bill.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/bills", {
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
      onDone();
    } catch {
      setError("Network error. Please retry.");
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
      <h2 className="text-lg font-semibold text-stone-900">{bill ? "Edit bill" : "New bill"}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Contractor</span>
          <select
            value={form.contractorId}
            onChange={(e) => patch({ contractorId: e.target.value })}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {contractors.length === 0 && <option value="">No contractors on this project</option>}
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Title</span>
          <input
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="e.g. June RA Bill"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Period start</span>
          <input
            type="date"
            value={form.periodStart}
            onChange={(e) => patch({ periodStart: e.target.value })}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Period end</span>
          <input
            type="date"
            value={form.periodEnd}
            onChange={(e) => patch({ periodEnd: e.target.value })}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">Line items</span>
          <button type="button" onClick={addLine} className="text-xs text-amber-600 font-medium">
            + Add line
          </button>
        </div>
        <ul className="space-y-2">
          {form.lines.map((l, i) => {
            const amount = preview.normalized[i]?.amount ?? 0;
            return (
              <li key={i} className="rounded-lg border border-stone-200 p-3 space-y-2">
                <div className="flex gap-2 items-start flex-wrap">
                  <select
                    value={l.type}
                    onChange={(e) => patchLine(i, { type: e.target.value as BillLineType })}
                    className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
                  >
                    {BILL_LINE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.description}
                    onChange={(e) => patchLine(i, { description: e.target.value })}
                    placeholder="Description"
                    className="flex-1 min-w-[8rem] rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
                  />
                  {form.lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-stone-400 hover:text-red-500 px-1.5 py-1.5"
                      aria-label="Remove line"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-wrap text-sm">
                  {l.type === "LUMP_SUM" ? (
                    <label className="flex items-center gap-1.5">
                      <span className="text-xs text-stone-500">Amount ₹</span>
                      <input
                        type="number"
                        min={0}
                        value={l.amount || ""}
                        onChange={(e) => patchLine(i, { amount: Number(e.target.value) })}
                        className="w-32 rounded-md border border-stone-300 px-2 py-1 text-sm"
                      />
                    </label>
                  ) : (
                    <>
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs text-stone-500">Qty</span>
                        <input
                          type="number"
                          min={0}
                          value={l.quantity ?? ""}
                          onChange={(e) => patchLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })}
                          className="w-20 rounded-md border border-stone-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <input
                        value={l.unit ?? ""}
                        onChange={(e) => patchLine(i, { unit: e.target.value || null })}
                        placeholder="unit"
                        className="w-20 rounded-md border border-stone-300 px-2 py-1 text-sm"
                      />
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs text-stone-500">Rate ₹</span>
                        <input
                          type="number"
                          min={0}
                          value={l.rate ?? ""}
                          onChange={(e) => patchLine(i, { rate: e.target.value === "" ? null : Number(e.target.value) })}
                          className="w-28 rounded-md border border-stone-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </>
                  )}
                  <span className="ml-auto text-sm font-medium text-stone-900 tabular-nums">{inr(amount)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Tax % <span className="text-stone-400">(optional, e.g. GST)</span>
          </span>
          <input
            type="number"
            min={0}
            value={form.taxPercent}
            onChange={(e) => patch({ taxPercent: e.target.value })}
            placeholder="0"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Notes</span>
          <input
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="rounded-lg bg-stone-50 p-3 text-sm">
        <div className="flex justify-between text-stone-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{inr(preview.subtotal)}</span>
        </div>
        {preview.tax > 0 && (
          <div className="flex justify-between text-stone-600">
            <span>Tax</span>
            <span className="tabular-nums">{inr(preview.tax)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-stone-900 mt-1 pt-1 border-t border-stone-200">
          <span>Total</span>
          <span className="tabular-nums">{inr(preview.total)}</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : bill ? "Save changes" : "Create bill"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
