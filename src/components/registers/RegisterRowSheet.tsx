"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ClipboardCheck, Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  addDays,
  formatIsoDay,
  isIsoDay,
  validateRowValues,
  type RegisterColumn,
  type RegisterValues,
} from "@/lib/registers";
import { formatDayMonthYear } from "@/lib/dates";

export type SheetRow = {
  id: string;
  identifier: string;
  values: RegisterValues;
  villaId: string | null;
  villaLabel: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  firstSubmittedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

export type SheetConfig = {
  projectId: string;
  typeCode: string;
  shortName: string;
  columns: RegisterColumn[];
  identifierKey: string;
  dueDateKey: string | null;
  lastInspectedKey: string | null;
  defaultIntervalDays: number | null;
  villas: Array<{ id: string; label: string }>;
  /** InspectionTemplate.id of the linked checklist (CL-SAF-03), if seeded. */
  inspectionTemplateId: string | null;
  todayIso: string;
};

const OTHER = "__other__";

/**
 * Add / edit one register item in a bottom sheet. Fields come from the
 * register type's column schema, validated with the same function the
 * API uses so the phone catches mistakes before a round trip.
 *
 * Picking "Date of Last Inspection" pre-fills the due date (+ the type's
 * interval) unless the user has typed their own due date.
 */
export default function RegisterRowSheet({
  config,
  row,
  onClose,
  onSaved,
}: {
  config: SheetConfig;
  /** null = add a new item */
  row: SheetRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { columns, dueDateKey, lastInspectedKey, defaultIntervalDays } = config;
  const retired = !!row?.retiredAt;
  const [values, setValues] = useState<RegisterValues>(() => {
    if (row) return { ...row.values };
    const v: RegisterValues = {};
    if (lastInspectedKey) v[lastInspectedKey] = config.todayIso;
    if (lastInspectedKey && dueDateKey && defaultIntervalDays) {
      v[dueDateKey] = addDays(config.todayIso, defaultIntervalDays);
    }
    return v;
  });
  // "Other" mode per select column: on when the saved value isn't one of the options.
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const c of columns) {
      if (c.kind === "select" && c.allowOther) {
        const v = row?.values[c.key];
        m[c.key] = !!v && !(c.options ?? []).includes(v);
      }
    }
    return m;
  });
  // Whether the due date is still the auto-filled one (so re-picking the
  // last-inspected date keeps it in step). Starts true for new rows.
  const [dueAuto, setDueAuto] = useState(() => {
    if (!row || !dueDateKey || !lastInspectedKey || !defaultIntervalDays) return !row;
    const last = row.values[lastInspectedKey];
    return !!last && isIsoDay(last) && row.values[dueDateKey] === addDays(last, defaultIntervalDays);
  });
  const [villaId, setVillaId] = useState<string>(row?.villaId ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"edit" | "retire" | "delete">("edit");
  const [retireReason, setRetireReason] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function setField(key: string, value: string) {
    setValues((cur) => {
      const next = { ...cur, [key]: value };
      if (
        key === lastInspectedKey &&
        dueDateKey &&
        defaultIntervalDays &&
        dueAuto &&
        isIsoDay(value)
      ) {
        next[dueDateKey] = addDays(value, defaultIntervalDays);
      }
      return next;
    });
    if (key === dueDateKey) setDueAuto(false);
    setFieldErrors((cur) => {
      if (!cur[key]) return cur;
      const rest = { ...cur };
      delete rest[key];
      return rest;
    });
  }

  async function send(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> | null; status: number }> {
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { ok: res.ok, data, status: res.status };
    } catch {
      return { ok: false, data: { error: "No connection. Check your signal and try again." }, status: 0 };
    }
  }

  async function save() {
    if (saving) return;
    const check = validateRowValues(columns, values, { dueDateKey, lastInspectedKey });
    if (!check.ok) {
      setFieldErrors(check.errors);
      setError("Some fields need fixing.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = { values: check.values, villaId: villaId || null };
    const res = row
      ? await send(`/api/register-rows/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "update", ...payload, expectedUpdatedAt: row.updatedAt }),
        })
      : await send(`/api/projects/${config.projectId}/registers/${config.typeCode}/rows`, {
          method: "POST",
          body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }),
        });
    setSaving(false);
    if (!res.ok) {
      if (res.status === 409) {
        setError("Someone else edited this item while you had it open. Close and reopen to see their changes.");
        return;
      }
      setFieldErrors((res.data?.fieldErrors as Record<string, string>) ?? {});
      setError(String(res.data?.error ?? "Couldn't save."));
      return;
    }
    const id = check.values[config.identifierKey];
    onSaved(row ? `${id} updated` : `${id} added`);
  }

  async function retireOrRestore(action: "retire" | "restore") {
    if (!row || saving) return;
    setSaving(true);
    setError(null);
    const res = await send(`/api/register-rows/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        action,
        ...(action === "retire" ? { retiredReason: retireReason.trim() } : {}),
        expectedUpdatedAt: row.updatedAt,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(String(res.data?.error ?? "Couldn't save."));
      return;
    }
    onSaved(action === "retire" ? `${row.identifier} retired` : `${row.identifier} restored`);
  }

  async function remove() {
    if (!row || saving) return;
    setSaving(true);
    setError(null);
    const res = await send(`/api/register-rows/${row.id}`, { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      setError(String(res.data?.error ?? "Couldn't delete."));
      return;
    }
    onSaved(`${row.identifier} deleted`);
  }

  const checklistHref = useMemo(() => {
    if (!row || !config.inspectionTemplateId || retired) return null;
    const q = new URLSearchParams({
      module: "SAFETY",
      templateId: config.inspectionTemplateId,
      registerRowId: row.id,
    });
    return `/mobile/${config.projectId}/inspection/new?${q.toString()}`;
  }, [row, config.inspectionTemplateId, config.projectId, retired]);

  const title = row ? row.identifier : `Add ${config.shortName.replace(/s$/, "").toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-stone-900/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-h-[92vh] overflow-y-auto rounded-t-2xl bg-cream shadow-card px-5 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-12 h-1 rounded-full bg-stone-300 mb-3" aria-hidden="true" />
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-serif text-[22px] leading-tight text-ink truncate">{title}</h2>
          {retired && (
            <span className="shrink-0 rounded-full bg-stone-200 text-stone-700 text-[10px] font-semibold px-2 py-0.5">
              Retired
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-2.5">
            {error}
          </div>
        )}

        {retired && row ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-3">
              Retired {formatDayMonthYear(row.retiredAt)}
              {row.retiredReason ? ` — ${row.retiredReason}` : ""}. It stays on past sign-offs but not on new ones.
            </p>
            <ReadOnlyValues columns={columns} values={row.values} villaLabel={row.villaLabel} />
            <button
              type="button"
              onClick={() => retireOrRestore("restore")}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink text-white text-sm font-semibold py-3 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Put back on the live list
            </button>
          </div>
        ) : mode === "retire" && row ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-3">
              Retiring takes {row.identifier} off the live list (moved off site, condemned, replaced). It
              stays on past sign-offs.
            </p>
            <label className="block text-sm font-semibold text-stone-700" htmlFor="retire-reason">
              Reason
            </label>
            <textarea
              id="retire-reason"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="e.g. Discharged during fire drill, replaced by FE-16"
              className="w-full min-h-20 rounded-lg border border-stone-300 bg-white p-2.5 text-[15px]"
              maxLength={500}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("edit")} className="rounded-xl bg-stone-200 text-ink text-sm font-semibold py-3">
                Back
              </button>
              <button
                type="button"
                onClick={() => retireOrRestore("retire")}
                disabled={saving || retireReason.trim().length < 3}
                className="rounded-xl bg-ink text-white text-sm font-semibold py-3 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Retire"}
              </button>
            </div>
          </div>
        ) : mode === "delete" && row ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-3">
              Delete {row.identifier}? Only do this for an item added by mistake. It has never been on a
              sign-off, so nothing else changes.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode("edit")} className="rounded-xl bg-stone-200 text-ink text-sm font-semibold py-3">
                Back
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="rounded-xl bg-red-600 text-white text-sm font-semibold py-3 disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {columns.map((c) => (
              <Field
                key={c.key}
                column={c}
                value={values[c.key] ?? ""}
                error={fieldErrors[c.key]}
                other={!!otherMode[c.key]}
                onOther={(on) => {
                  setOtherMode((m) => ({ ...m, [c.key]: on }));
                  setField(c.key, "");
                }}
                onChange={(v) => setField(c.key, v)}
                hint={
                  c.key === dueDateKey && dueAuto && defaultIntervalDays
                    ? `Set to ${defaultIntervalDays} days after the last inspection. Change it if needed.`
                    : undefined
                }
              />
            ))}

            {config.villas.length > 0 && (
              <div>
                <label className="block text-[13px] font-semibold text-stone-700 mb-1" htmlFor="reg-villa">
                  Villa <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <select
                  id="reg-villa"
                  value={villaId}
                  onChange={(e) => setVillaId(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-[15px]"
                >
                  <option value="">Not in a villa</option>
                  {config.villas.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-ferrous-500 text-white text-sm font-semibold py-3 disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {row ? "Save changes" : "Add to register"}
            </button>

            {row && (
              <div className="pt-1 space-y-2 border-t border-sandstone-100">
                {checklistHref && (
                  <Link
                    href={checklistHref}
                    className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white ring-1 ring-stone-300 text-ink text-sm font-semibold py-3"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    Raise inspection checklist
                  </Link>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setMode("retire")}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-200 text-ink text-sm font-semibold py-2.5"
                  >
                    <Archive className="w-4 h-4" />
                    Retire
                  </button>
                  {row.firstSubmittedAt ? (
                    <p className="text-[11px] text-stone-500 self-center leading-snug">
                      On a past sign-off, so it can be retired but not deleted.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMode("delete")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-200 text-red-700 text-sm font-semibold py-2.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </div>
                {row.updatedByName && (
                  <p className="text-[11px] text-stone-500 text-center pt-1">Last edited by {row.updatedByName}</p>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  column: c,
  value,
  error,
  other,
  onOther,
  onChange,
  hint,
}: {
  column: RegisterColumn;
  value: string;
  error?: string;
  other: boolean;
  onOther: (on: boolean) => void;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const id = `reg-${c.key}`;
  const base = `w-full rounded-lg border bg-white px-3 py-2.5 text-[15px] ${error ? "border-red-400" : "border-stone-300"}`;
  return (
    <div>
      <label className="block text-[13px] font-semibold text-stone-700 mb-1" htmlFor={id}>
        {c.label}
        {!c.required && <span className="font-normal text-stone-500"> (optional)</span>}
      </label>
      {c.kind === "select" ? (
        <>
          <select
            id={id}
            value={other ? OTHER : value}
            onChange={(e) => {
              if (e.target.value === OTHER) onOther(true);
              else {
                if (other) onOther(false);
                onChange(e.target.value);
              }
            }}
            className={base}
          >
            <option value="">Select…</option>
            {(c.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {c.allowOther && <option value={OTHER}>Other…</option>}
          </select>
          {other && (
            <input
              aria-label={`${c.label} (other)`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type it in"
              className={`${base} mt-2`}
              maxLength={200}
              autoFocus
            />
          )}
        </>
      ) : (
        <input
          id={id}
          type={c.kind === "date" ? "date" : c.kind === "number" ? "number" : "text"}
          inputMode={c.kind === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={c.placeholder}
          className={base}
          maxLength={200}
        />
      )}
      {error ? (
        <p className="text-[12px] text-red-700 mt-1">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-stone-500 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

function ReadOnlyValues({
  columns,
  values,
  villaLabel,
}: {
  columns: RegisterColumn[];
  values: RegisterValues;
  villaLabel: string | null;
}) {
  return (
    <dl className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
      {columns.map((c) => (
        <div key={c.key}>
          <dt className="text-[10px] uppercase tracking-wider text-stone-500">{c.label}</dt>
          <dd className="text-[14px] text-ink">
            {c.kind === "date" ? formatIsoDay(values[c.key]) : values[c.key] || "—"}
          </dd>
        </div>
      ))}
      {villaLabel && (
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-stone-500">Villa</dt>
          <dd className="text-[14px] text-ink">{villaLabel}</dd>
        </div>
      )}
    </dl>
  );
}
