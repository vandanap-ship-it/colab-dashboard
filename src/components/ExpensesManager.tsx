"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Check, X, RotateCcw, Download } from "lucide-react";
import {
  EXPENSE_CATEGORIES,
  expensesToCsv,
  summariseExpenses,
  type ExpenseCategory,
} from "@/lib/expenses";

type Person = { id: string; name: string } | null;
type Photo = { id: string; url: string };

type Expense = {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paidTo: string | null;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  notes: string | null;
  updatedAt: string; // echoed on PATCH so the server's concurrency guard fires
  loggedBy: Person;
  approvedBy: Person;
  photos: Photo[];
};

const STATUS_STYLE: Record<Expense["status"], string> = {
  SUBMITTED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function ExpensesManager({
  projectId,
  canApprove,
  currentUserId,
  isAdmin,
}: {
  projectId: string;
  canApprove: boolean;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | Expense["status"]>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | string>("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`/api/expenses?projectId=${projectId}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setExpenses(d.expenses ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const summary = useMemo(() => summariseExpenses(expenses ?? []), [expenses]);
  const filtered = useMemo(() => {
    if (!expenses) return [];
    return expenses.filter(
      (e) =>
        (statusFilter === "ALL" || e.status === statusFilter) &&
        (categoryFilter === "ALL" || e.category === categoryFilter),
    );
  }, [expenses, statusFilter, categoryFilter]);

  function downloadCsv() {
    const csv = expensesToCsv(
      filtered.map((e) => ({
        date: e.date.slice(0, 10),
        category: e.category,
        description: e.description,
        paidTo: e.paidTo,
        amount: e.amount,
        status: e.status,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project-expenses.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function changeStatus(exp: Expense, status: Expense["status"], rejectionReason?: string) {
    setBusyId(exp.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/expenses/${exp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason, expectedUpdatedAt: exp.updatedAt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409) {
          setActionError("Someone else just edited this expense — reloading so you see the latest.");
          reload();
        } else {
          setActionError(data?.error ?? `Action failed (${res.status})`);
        }
      } else {
        reload();
      }
    } catch {
      setActionError("Network error. Please retry.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(exp: Expense) {
    if (!confirm("Move this expense to trash?")) return;
    setBusyId(exp.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/expenses/${exp.id}`, { method: "DELETE" });
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

  function reject(exp: Expense) {
    const reason = prompt("Reason for rejection (optional):") ?? "";
    return changeStatus(exp, "REJECTED", reason);
  }

  if (editing) {
    return (
      <ExpenseEditor
        projectId={projectId}
        expense={editing === "new" ? null : editing}
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
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">Expenses</h2>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-stone-800"
        >
          <Plus className="w-4 h-4" />
          Log expense
        </button>
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {loadError ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-sm text-stone-600">Couldn&apos;t load expenses.</p>
          <button type="button" onClick={reload} className="mt-2 text-sm font-medium text-stone-900 underline">
            Retry
          </button>
        </div>
      ) : !expenses ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : expenses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">No expenses logged yet.</p>
          <button type="button" onClick={() => setEditing("new")} className="mt-2 text-sm font-medium text-amber-600">
            Log the first expense
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(["SUBMITTED", "APPROVED", "REJECTED"] as const).map((s) => {
              const stat = summary.byStatus[s];
              if (!stat) return null;
              return (
                <div key={s} className={`rounded-lg px-3 py-2 ${STATUS_STYLE[s]}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider">{s}</div>
                  <div className="text-sm font-semibold tabular-nums">{inr(stat.total)}</div>
                  <div className="text-[10px] opacity-70">
                    {stat.count} item{stat.count === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
            <div className="rounded-lg px-3 py-2 bg-stone-900 text-white ml-auto">
              <div className="text-[10px] font-semibold uppercase tracking-wider">Approved</div>
              <div className="text-sm font-semibold tabular-nums">{inr(summary.approvedTotal)}</div>
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
                {(["SUBMITTED", "APPROVED", "REJECTED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="ALL">All categories</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
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
            <p className="text-sm text-stone-500">No expenses match the current filter.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((exp) => {
                const isLogger = exp.loggedBy?.id === currentUserId;
                const editable = exp.status !== "APPROVED" && (isLogger || canApprove);
                const deletable = exp.status !== "APPROVED" && (isLogger || isAdmin);
                return (
                  <li key={exp.id} className="rounded-xl border border-stone-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-stone-900">{exp.description}</span>
                          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_STYLE[exp.status]}`}>
                            {exp.status}
                          </span>
                        </div>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {exp.category} · {fmtDate(exp.date)}
                          {exp.paidTo ? ` · ${exp.paidTo}` : ""}
                          {exp.loggedBy ? ` · by ${exp.loggedBy.name}` : ""}
                        </p>
                        {exp.status === "REJECTED" && exp.rejectionReason && (
                          <p className="text-xs text-red-600 mt-1">Rejected: {exp.rejectionReason}</p>
                        )}
                      </div>
                      <div className="text-lg font-semibold text-stone-900 tabular-nums">{inr(exp.amount)}</div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {canApprove && exp.status === "SUBMITTED" && (
                        <>
                          <ActionBtn onClick={() => changeStatus(exp, "APPROVED")} disabled={busyId === exp.id} tone="approve" icon={<Check className="w-3.5 h-3.5" />}>
                            Approve
                          </ActionBtn>
                          <ActionBtn onClick={() => reject(exp)} disabled={busyId === exp.id} tone="reject" icon={<X className="w-3.5 h-3.5" />}>
                            Reject
                          </ActionBtn>
                        </>
                      )}
                      {isLogger && exp.status === "REJECTED" && (
                        <ActionBtn onClick={() => changeStatus(exp, "SUBMITTED")} disabled={busyId === exp.id} icon={<RotateCcw className="w-3.5 h-3.5" />}>
                          Resubmit
                        </ActionBtn>
                      )}
                      {editable && (
                        <ActionBtn onClick={() => setEditing(exp)} disabled={busyId === exp.id} icon={<Pencil className="w-3.5 h-3.5" />}>
                          Edit
                        </ActionBtn>
                      )}
                      {deletable && (
                        <ActionBtn onClick={() => remove(exp)} disabled={busyId === exp.id} tone="reject" icon={<Trash2 className="w-3.5 h-3.5" />}>
                          Delete
                        </ActionBtn>
                      )}
                    </div>
                  </li>
                );
              })}
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

function ExpenseEditor({
  projectId,
  expense,
  onDone,
  onCancel,
}: {
  projectId: string;
  expense: Expense | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory | string>(expense?.category ?? EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [date, setDate] = useState(expense ? expense.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (description.trim().length < 2) {
      setError("Add a short description.");
      return;
    }
    if (!(Number(amount) > 0)) {
      setError("Amount must be greater than 0.");
      return;
    }
    setPending(true);
    setError(null);
    const payload = {
      projectId,
      category,
      description: description.trim(),
      amount: Number(amount),
      date,
      paidTo,
      notes,
      idempotencyKey: expense ? undefined : crypto.randomUUID(),
    };
    try {
      const res = expense
        ? await fetch(`/api/expenses/${expense.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, expectedUpdatedAt: expense.updatedAt }),
          })
        : await fetch("/api/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409) {
          setError("Someone else just edited this expense. Close and reopen to see their changes.");
        } else {
          setError(data?.error ?? `Save failed (${res.status})`);
        }
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
      <h2 className="text-lg font-semibold text-stone-900">{expense ? "Edit expense" : "Log expense"}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Amount ₹</span>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-stone-700">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Cement bags from local supplier"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-stone-700">
            Paid to <span className="text-stone-400">(optional)</span>
          </span>
          <input
            value={paidTo}
            onChange={(e) => setPaidTo(e.target.value)}
            placeholder="Vendor / payee"
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-stone-700">
            Notes <span className="text-stone-400">(optional)</span>
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : expense ? "Save changes" : "Log expense"}
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
