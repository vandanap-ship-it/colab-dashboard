"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  addDays,
  dueLabel,
  dueState,
  formatIsoDay,
  isIsoDay,
  validateRowValues,
  type RegisterColumn,
  type RegisterValues,
} from "@/lib/registers";
import type { SheetConfig, SheetRow } from "./RegisterRowSheet";

/**
 * Desktop spreadsheet view of a register for planners doing bulk entry:
 * one table row per item, Edit turns a row into inputs in place, and a
 * blank row at the bottom adds a new item. Same API + validation as the
 * phone sheet. Sign-off still happens through the shared submit screen.
 */
export default function RegisterGrid({ config, rows }: { config: SheetConfig; rows: SheetRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(
    () => rows.filter((r) => (showRetired ? true : !r.retiredAt)),
    [rows, showRetired],
  );
  const retiredCount = rows.length - rows.filter((r) => !r.retiredAt).length;

  function done(msg: string) {
    setEditingId(null);
    setMessage(msg);
    window.setTimeout(() => setMessage(null), 3000);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired ({retiredCount})
        </label>
        {message && (
          <span role="status" className="text-sm text-emerald-700">
            {message}
          </span>
        )}
      </div>
      <div className="rounded-xl border border-stone-200 bg-white overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-stone-50">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500 w-10">#</th>
              {config.columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500 whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              {config.villas.length > 0 && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500">Villa</th>
              )}
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500">Status</th>
              <th className="px-3 py-2 w-40" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) =>
              editingId === r.id ? (
                <EditRow key={r.id} index={i + 1} config={config} row={r} onCancel={() => setEditingId(null)} onDone={done} />
              ) : (
                <ViewRow
                  key={r.id}
                  index={i + 1}
                  config={config}
                  row={r}
                  onEdit={() => setEditingId(r.id)}
                  onDone={done}
                  disabled={editingId !== null}
                />
              ),
            )}
            <EditRow key={`new-${rows.length}`} index={visible.length + 1} config={config} row={null} onDone={done} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ViewRow({
  index,
  config,
  row,
  onEdit,
  onDone,
  disabled,
}: {
  index: number;
  config: SheetConfig;
  row: SheetRow;
  onEdit: () => void;
  onDone: (msg: string) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = row.retiredAt || !config.dueDateKey ? "none" : dueState(row.values[config.dueDateKey], config.todayIso);

  async function act(init: RequestInit, msg: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/register-rows/${row.id}`, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Couldn't save");
        return;
      }
      onDone(msg);
    } catch {
      setError("No connection");
    } finally {
      setBusy(false);
    }
  }

  function retire() {
    const reason = window.prompt(`Why is ${row.identifier} being retired?`);
    if (!reason || reason.trim().length < 3) return;
    void act(
      { method: "PATCH", body: JSON.stringify({ action: "retire", retiredReason: reason.trim(), expectedUpdatedAt: row.updatedAt }) },
      `${row.identifier} retired`,
    );
  }

  return (
    <tr className={`border-t border-stone-100 ${row.retiredAt ? "text-stone-400" : state === "overdue" ? "bg-red-50/60" : ""}`}>
      <td className="px-3 py-2 tabular-nums text-stone-500">{index}</td>
      {config.columns.map((c) => (
        <td key={c.key} className={`px-3 py-2 ${c.kind === "date" ? "whitespace-nowrap tabular-nums" : ""}`}>
          {c.kind === "date" ? formatIsoDay(row.values[c.key]) : row.values[c.key] || "—"}
        </td>
      ))}
      {config.villas.length > 0 && <td className="px-3 py-2">{row.villaLabel ?? "—"}</td>}
      <td className="px-3 py-2 whitespace-nowrap">
        {row.retiredAt ? (
          <span className="text-xs">Retired{row.retiredReason ? ` · ${row.retiredReason}` : ""}</span>
        ) : (
          <span
            className={`text-xs font-semibold ${
              state === "overdue" ? "text-red-700" : state === "due_soon" ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {dueLabel(config.dueDateKey ? row.values[config.dueDateKey] : null, config.todayIso)}
          </span>
        )}
        {error && <p className="text-xs text-red-700 mt-0.5">{error}</p>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin inline" />
        ) : row.retiredAt ? (
          <IconBtn
            label="Restore"
            disabled={disabled}
            onClick={() =>
              act({ method: "PATCH", body: JSON.stringify({ action: "restore", expectedUpdatedAt: row.updatedAt }) }, `${row.identifier} restored`)
            }
          >
            <RotateCcw className="w-4 h-4" />
          </IconBtn>
        ) : (
          <>
            <IconBtn label="Edit" disabled={disabled} onClick={onEdit}>
              <Pencil className="w-4 h-4" />
            </IconBtn>
            <IconBtn label="Retire" disabled={disabled} onClick={retire}>
              <Archive className="w-4 h-4" />
            </IconBtn>
            {!row.firstSubmittedAt && (
              <IconBtn
                label="Delete"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(`Delete ${row.identifier}? Only for items added by mistake.`)) {
                    void act({ method: "DELETE" }, `${row.identifier} deleted`);
                  }
                }}
              >
                <Trash2 className="w-4 h-4 text-red-600" />
              </IconBtn>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function EditRow({
  index,
  config,
  row,
  onCancel,
  onDone,
}: {
  index: number;
  config: SheetConfig;
  row: SheetRow | null;
  onCancel?: () => void;
  onDone: (msg: string) => void;
}) {
  const { columns, dueDateKey, lastInspectedKey, defaultIntervalDays } = config;
  const [values, setValues] = useState<RegisterValues>(() => (row ? { ...row.values } : {}));
  const [villaId, setVillaId] = useState(row?.villaId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = !row;

  function set(key: string, v: string) {
    setValues((cur) => {
      const next = { ...cur, [key]: v };
      // Fill the due date from the last inspection when it's still blank.
      if (key === lastInspectedKey && dueDateKey && defaultIntervalDays && isIsoDay(v) && !cur[dueDateKey]) {
        next[dueDateKey] = addDays(v, defaultIntervalDays);
      }
      return next;
    });
  }

  async function save() {
    const check = validateRowValues(columns, values, { dueDateKey, lastInspectedKey });
    if (!check.ok) {
      setErrors(check.errors);
      setError("Fix the highlighted cells");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = row
        ? await fetch(`/api/register-rows/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", values: check.values, villaId: villaId || null, expectedUpdatedAt: row.updatedAt }),
          })
        : await fetch(`/api/projects/${config.projectId}/registers/${config.typeCode}/rows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values: check.values, villaId: villaId || null, idempotencyKey: crypto.randomUUID() }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors(data?.fieldErrors ?? {});
        setError(res.status === 409 ? "Someone else edited this row. Cancel and try again." : data?.error ?? "Couldn't save");
        return;
      }
      const id = check.values[config.identifierKey];
      if (isNew) {
        setValues({});
        setVillaId("");
        setErrors({});
      }
      onDone(isNew ? `${id} added` : `${id} updated`);
    } catch {
      setError("No connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={`border-t border-stone-200 align-top ${isNew ? "bg-sandstone-50/50" : "bg-amber-50/40"}`}>
      <td className="px-3 py-2 tabular-nums text-stone-400">{isNew ? <Plus className="w-4 h-4" /> : index}</td>
      {columns.map((c) => (
        <td key={c.key} className="px-2 py-1.5">
          <Cell column={c} value={values[c.key] ?? ""} onChange={(v) => set(c.key, v)} invalid={!!errors[c.key]} title={errors[c.key]} />
        </td>
      ))}
      {config.villas.length > 0 && (
        <td className="px-2 py-1.5">
          <select
            aria-label="Villa"
            value={villaId}
            onChange={(e) => setVillaId(e.target.value)}
            className="w-full min-w-[7rem] rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {config.villas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </td>
      )}
      <td className="px-3 py-2 text-xs text-red-700 max-w-[14rem]">{error}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin inline" />
        ) : (
          <>
            <IconBtn label={isNew ? "Add" : "Save"} onClick={save}>
              {isNew ? <Plus className="w-4 h-4" /> : <Check className="w-4 h-4 text-emerald-700" />}
            </IconBtn>
            {onCancel && (
              <IconBtn label="Cancel" onClick={onCancel}>
                <X className="w-4 h-4" />
              </IconBtn>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function Cell({
  column: c,
  value,
  onChange,
  invalid,
  title,
}: {
  column: RegisterColumn;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  title?: string;
}) {
  const cls = `w-full rounded border bg-white px-2 py-1.5 text-sm ${invalid ? "border-red-400" : "border-stone-300"}`;
  if (c.kind === "select") {
    const listId = `opts-${c.key}`;
    // A datalist keeps the preset options one click away while still
    // allowing a typed value when the column accepts "Other".
    if (c.allowOther) {
      return (
        <>
          <input list={listId} aria-label={c.label} title={title} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} min-w-[9rem]`} placeholder="Select or type" />
          <datalist id={listId}>
            {(c.options ?? []).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      );
    }
    return (
      <select aria-label={c.label} title={title} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} min-w-[9rem]`}>
        <option value="">Select…</option>
        {(c.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={c.label}
      title={title}
      type={c.kind === "date" ? "date" : c.kind === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={c.placeholder}
      className={`${cls} ${c.kind === "date" ? "min-w-[9rem]" : "min-w-[8rem]"}`}
    />
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-stone-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
