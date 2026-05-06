"use client";

import { useState } from "react";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { changeOwnPassword, updateOwnName } from "@/app/profile/actions";

export function EditNameCard({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const res = await updateOwnName(fd);
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "Saved." });
      setEditing(false);
      router.refresh();
    } else {
      setMsg({ tone: "err", text: res.error });
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-soft">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-widest">
          Display name
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setMsg(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-stone-300 bg-white px-3 py-1 text-stone-700 hover:bg-stone-50 hover:border-stone-400 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={80}
            defaultValue={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-sm rounded-md bg-stone-900 text-white px-3 py-1.5 hover:bg-stone-800 disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(initialName);
                setMsg(null);
              }}
              className="inline-flex items-center gap-1.5 text-sm rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
          {msg && (
            <p
              className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}
            >
              {msg.text}
            </p>
          )}
        </form>
      ) : (
        <div className="mt-3">
          <p className="text-stone-900 font-medium">{name}</p>
          <p className="text-[11px] text-stone-500 mt-1">
            Your username (login handle) can&apos;t be changed.
          </p>
          {msg?.tone === "ok" && (
            <p className="text-xs text-emerald-700 mt-2">{msg.text}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function ChangePasswordCard() {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const res = await changeOwnPassword(fd);
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "Password updated." });
      form.reset();
    } else {
      setMsg({ tone: "err", text: res.error });
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-soft">
      <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-widest">
        Change password
      </h2>
      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PasswordField name="current" label="Current password" autoComplete="current-password" />
        <PasswordField name="next" label="New password" autoComplete="new-password" />
        <PasswordField
          name="confirm"
          label="Confirm new password"
          autoComplete="new-password"
        />
        <div className="sm:col-span-3 flex items-center justify-between gap-3 pt-1">
          {msg ? (
            <p
              className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}
            >
              {msg.text}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-sm rounded-md bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Update password
          </button>
        </div>
      </form>
    </section>
  );
}

function PasswordField({
  name,
  label,
  autoComplete,
}: {
  name: string;
  label: string;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
        {label}
      </span>
      <input
        type="password"
        name={name}
        required
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
      />
    </label>
  );
}
