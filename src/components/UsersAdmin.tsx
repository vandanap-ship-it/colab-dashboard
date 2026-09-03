"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Pencil, Plus, X } from "lucide-react";
import { ROLE_LABELS, ROLES } from "@/lib/roles";

type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
  // Echoed back on PATCH so the server can reject stale writes when two
  // admins edit the same user at the same time (optimistic-lock guard).
  updatedAt: string;
};

const ROLE_OPTIONS = Object.values(ROLES);

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>(ROLES.SITE_ENGINEER);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    const data = await res.json();
    setUsers(data.users);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, name, role, password }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    setUsername("");
    setName("");
    setPassword("");
    setRole(ROLES.SITE_ENGINEER);
    setCreating(false);
    load();
  }

  async function toggleActive(u: UserRow) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active, expectedUpdatedAt: u.updatedAt }),
    });
    if (res.status === 409) {
      alert("Another admin just edited this user. Refreshing so you see the latest.");
      load();
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    load();
  }

  async function changeRole(u: UserRow, newRole: string) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole, expectedUpdatedAt: u.updatedAt }),
    });
    if (res.status === 409) {
      alert("Another admin just edited this user. Refreshing so you see the latest.");
      load();
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    load();
  }

  async function saveName(u: UserRow) {
    const trimmed = editingName.trim();
    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, expectedUpdatedAt: u.updatedAt }),
    });
    if (res.status === 409) {
      alert("Another admin just edited this user. Refreshing so you see the latest.");
      setEditingId(null);
      setEditingName("");
      load();
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    setEditingId(null);
    setEditingName("");
    setError(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Users</h1>
          <p className="text-sm text-stone-500 mt-1">
            Create accounts, change roles, deactivate, or reset a user&apos;s password.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 transition-colors"
        >
          {creating ? (
            <>
              <X className="w-4 h-4" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              New user
            </>
          )}
        </button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-stone-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-5 gap-3"
        >
          <input
            required
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
          />
          <input
            required
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <input
            required
            type="password"
            placeholder="Initial password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 disabled:opacity-60 transition-colors"
          >
            {pending ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {users === null ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-left">
              <tr className="text-[10px] uppercase tracking-wider">
                <th className="px-4 py-2 font-medium">Username</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = editingId === u.id;
                return (
                  <tr key={u.id} className="border-t border-stone-100">
                    <td className="px-4 py-2 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="flex-1 rounded-md border border-stone-300 px-2 py-1 text-sm focus:outline-none focus:border-stone-900"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => saveName(u)}
                            className="p-1 rounded-md text-emerald-700 hover:bg-emerald-50"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditingName("");
                              setError(null);
                            }}
                            className="p-1 rounded-md text-stone-500 hover:bg-stone-50"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-stone-900">{u.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs focus:outline-none focus:border-stone-900"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 ${
                          u.active
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-stone-100 text-stone-500 ring-stone-200"
                        }`}
                      >
                        {u.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(u.id);
                              setEditingName(u.name);
                            }}
                            className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                            title="Edit name"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setResettingId(u.id)}
                          className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                          title="Reset password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          className="text-xs text-stone-600 hover:text-stone-900 underline-offset-2 hover:underline ml-1"
                        >
                          {u.active ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {resettingId && (
        <ResetPasswordDialog
          user={users?.find((u) => u.id === resettingId) ?? null}
          onClose={() => setResettingId(null)}
        />
      )}
    </div>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (pw !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${user!.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setPending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    setSuccess(true);
    setTimeout(onClose, 1200);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 backdrop-blur-sm overflow-y-auto p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-stone-200 shadow-elevated w-full max-w-md mt-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-stone-900 inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-stone-500" />
            Reset password for {user.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 p-1 rounded-md hover:bg-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
          <p className="text-xs text-stone-500">
            The user will need this new password to sign in.
          </p>
          <label className="block">
            <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
              New password
            </span>
            <input
              type="password"
              required
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
              Confirm new password
            </span>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:border-stone-900"
            />
          </label>
          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              Password reset.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="text-sm rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="text-sm rounded-md bg-stone-900 text-white px-4 py-1.5 hover:bg-stone-800 disabled:opacity-60"
            >
              {pending ? "Resetting…" : "Reset password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
