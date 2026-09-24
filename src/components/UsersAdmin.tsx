"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, KeyRound, Pencil, Plus, X } from "lucide-react";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { ALL_MODULES, MODULE_LABELS, parseUserModules, type ModuleKey } from "@/lib/modules";

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
  // Module scope. NULL = full access (internal staff). A JSON array
  // string like `["QAQC","SAFETY"]` = scoped user, sees only mobile
  // tools + records tagged with those modules. Parsed via
  // parseUserModules from @/lib/modules.
  modules: string | null;
  // Optional contractor tie — surfaces contractor-attributed inspections
  // and issues in QA/QC + EHS Contractor Performance matrices.
  contractorId: string | null;
  contractor: { id: string; name: string; project: { id: string; name: string } } | null;
  // Opt-in flags for the daily site-team automations. Setting either from
  // here adds or removes the user from the corresponding cron's recipient
  // set without any code change.
  receivesDailyTaskEmail: boolean;
  receivesDailyNudge: boolean;
  // Shows this user in the mobile Raise Permit approver picker.
  canApproveWorkPermits: boolean;
};

type ContractorOption = {
  id: string;
  name: string;
  active: boolean;
  project: { id: string; name: string };
};

const ROLE_OPTIONS = Object.values(ROLES);

export default function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>(ROLES.SITE_ENGINEER);
  // Module scope on create. Empty set = full access (internal staff);
  // pick specific modules to scope the new user immediately, so admin
  // doesn't have to create + re-open the picker as a second step.
  const [newModules, setNewModules] = useState<Set<ModuleKey>>(new Set());
  const [password, setPassword] = useState("");
  const [pwGenerated, setPwGenerated] = useState(false);
  const [pwCopied, setPwCopied] = useState(false);
  const [pending, setPending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  // Modules picker · null when closed. When set to a user id, the module
  // picker sheet opens for that user. Local edits stage in
  // pendingModules; Save posts them, Cancel closes without saving.
  const [modulesPickerId, setModulesPickerId] = useState<string | null>(null);
  const [pendingModules, setPendingModules] = useState<Set<ModuleKey>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    const data = await res.json();
    setUsers(data.users);
  }, []);

  const loadContractors = useCallback(async () => {
    const res = await fetch("/api/admin/contractors", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setContractors((data.contractors ?? []).filter((c: ContractorOption) => c.active));
  }, []);

  useEffect(() => {
    load();
    loadContractors();
  }, [load, loadContractors]);

  async function toggleDailyFlag(
    u: UserRow,
    flag: "receivesDailyTaskEmail" | "receivesDailyNudge" | "canApproveWorkPermits",
    next: boolean,
  ) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [flag]: next, expectedUpdatedAt: u.updatedAt }),
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

  async function changeContractor(u: UserRow, newContractorId: string | null) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractorId: newContractorId, expectedUpdatedAt: u.updatedAt }),
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const modulesArr = Array.from(newModules);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        name,
        role,
        password,
        // Null means full access on the server side; sending an empty
        // array would also work, but null reads clearer in the audit
        // trail as "no scope set" rather than "scoped to nothing".
        modules: modulesArr.length === 0 ? null : modulesArr,
      }),
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
    setPwGenerated(false);
    setPwCopied(false);
    setRole(ROLES.SITE_ENGINEER);
    setNewModules(new Set());
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

  function openModulesPicker(u: UserRow) {
    const current = parseUserModules(u.modules) ?? new Set<ModuleKey>();
    setPendingModules(new Set(current));
    setModulesPickerId(u.id);
  }

  function toggleModuleInPicker(module: ModuleKey) {
    setPendingModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  /**
   * Save the pending module set to the current picker user. An empty
   * set clears scoping — internal staff = null modules = full access.
   * Any non-empty subset scopes the user to those modules only.
   */
  async function saveModules(u: UserRow) {
    const arr = Array.from(pendingModules);
    const bodyModules: string[] | null = arr.length === 0 ? null : arr;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: bodyModules, expectedUpdatedAt: u.updatedAt }),
    });
    if (res.status === 409) {
      alert("Another admin just edited this user. Refreshing so you see the latest.");
      setModulesPickerId(null);
      load();
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed");
      return;
    }
    setModulesPickerId(null);
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
          <div className="flex gap-1.5 col-span-1">
            <input
              required
              type={pwGenerated ? "text" : "password"}
              placeholder="Initial password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPwGenerated(false);
                setPwCopied(false);
              }}
              className="flex-1 min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-stone-900"
            />
            <button
              type="button"
              onClick={() => {
                const next = generateFriendlyPassword();
                setPassword(next);
                setPwGenerated(true);
                setPwCopied(false);
              }}
              title="Generate strong password"
              className="text-xs rounded-md border border-stone-300 bg-white px-2 hover:bg-stone-50"
            >
              ⟳
            </button>
            {pwGenerated && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    setPwCopied(true);
                    setTimeout(() => setPwCopied(false), 1500);
                  } catch {
                    // Clipboard blocked — password is visible, admin can copy manually
                  }
                }}
                className="text-xs rounded-md border border-stone-300 bg-white px-2 hover:bg-stone-50 whitespace-nowrap"
              >
                {pwCopied ? "✓" : "Copy"}
              </button>
            )}
          </div>
          {/* Module scope on create · lets an admin scope the new user
              on the same submission as their username + role. Empty =
              full access (internal staff). */}
          <div className="col-span-full">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
              Module scope (optional)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_MODULES.map((m) => {
                const active = newModules.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setNewModules((prev) => {
                        const next = new Set(prev);
                        if (next.has(m)) next.delete(m);
                        else next.add(m);
                        return next;
                      })
                    }
                    className={`text-[11px] font-medium rounded-md px-2 py-1 border transition-colors ${
                      active
                        ? "bg-stone-900 text-white border-stone-900"
                        : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
                    }`}
                  >
                    {MODULE_LABELS[m] ?? m}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-stone-500 mt-1.5 italic">
              {newModules.size === 0
                ? "Leave all off for full access (internal staff)."
                : `Scoped to ${newModules.size} of ${ALL_MODULES.length} module${newModules.size === 1 ? "" : "s"}.`}
            </div>
          </div>
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
                <th className="px-4 py-2 font-medium">Modules</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th
                  className="px-4 py-2 font-medium"
                  title="Task = 07:00 IST daily 'today's schedule' email. Nudge = 11:30 IST push if no progress logged. Permits = user is offered in the Raise Permit approver picker."
                >
                  Alerts
                </th>
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
                      {/* Modules picker — module scope determines which
                          mobile tools and records the user sees. NULL =
                          full access (internal); scoped users see only
                          their picked modules. Click to open picker. */}
                      <ModulesCell user={u} onEdit={() => openModulesPicker(u)} />
                    </td>
                    <td className="px-4 py-2">
                      {/* Contractor picker — nullable. Sets User.contractorId
                          so QA/QC + EHS Contractor Performance rollups can
                          attribute this user's inspections/issues back to a
                          contractor even when the underlying WBS row has no
                          contractor tag (Colab-imported inspections). */}
                      <select
                        value={u.contractorId ?? ""}
                        onChange={(e) =>
                          changeContractor(u, e.target.value === "" ? null : e.target.value)
                        }
                        className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs focus:outline-none focus:border-stone-900 max-w-[180px]"
                      >
                        <option value="">Internal / unassigned</option>
                        {contractors.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.project.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-stone-600">
                        <label className="inline-flex items-center gap-1 cursor-pointer" title="07:00 IST 'today's site tasks' email">
                          <input
                            type="checkbox"
                            checked={u.receivesDailyTaskEmail}
                            onChange={(e) => toggleDailyFlag(u, "receivesDailyTaskEmail", e.target.checked)}
                          />
                          Task
                        </label>
                        <label className="inline-flex items-center gap-1 cursor-pointer" title="11:30 IST 'log today's progress' push nudge">
                          <input
                            type="checkbox"
                            checked={u.receivesDailyNudge}
                            onChange={(e) => toggleDailyFlag(u, "receivesDailyNudge", e.target.checked)}
                          />
                          Nudge
                        </label>
                        <label className="inline-flex items-center gap-1 cursor-pointer" title="User is offered in the mobile Raise Permit approver picker">
                          <input
                            type="checkbox"
                            checked={u.canApproveWorkPermits}
                            onChange={(e) => toggleDailyFlag(u, "canApproveWorkPermits", e.target.checked)}
                          />
                          Permits
                        </label>
                      </div>
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

      {modulesPickerId && (() => {
        const user = users?.find((u) => u.id === modulesPickerId) ?? null;
        if (!user) return null;
        return (
          <ModulesPickerDialog
            user={user}
            pending={pendingModules}
            onToggle={toggleModuleInPicker}
            onSave={() => saveModules(user)}
            onClearAll={() => setPendingModules(new Set())}
            onClose={() => setModulesPickerId(null)}
          />
        );
      })()}
    </div>
  );
}

/**
 * Table-cell display for a user's module scope. Styled like the
 * neighbouring Role and Contractor dropdowns so it reads as an
 * interactive control at a glance — border, chevron, hover state.
 * Shows either "All modules" (null = internal staff, full access) or
 * a compact list of module labels (scoped user). Click opens the
 * picker dialog.
 */
function ModulesCell({ user, onEdit }: { user: UserRow; onEdit: () => void }) {
  const parsed = parseUserModules(user.modules);
  return (
    <button
      type="button"
      onClick={onEdit}
      className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs hover:border-stone-900 hover:bg-stone-50 focus:outline-none focus:border-stone-900 max-w-[240px] transition-colors"
      title="Edit module scope"
    >
      {parsed === null ? (
        <span className="text-stone-900 font-medium">All modules</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {Array.from(parsed).map((m) => (
            <span
              key={m}
              className="inline-block text-[10px] font-semibold uppercase tracking-wider bg-ferrous-50 text-ferrous-600 px-1.5 py-0.5 rounded"
            >
              {shortLabelFor(m)}
            </span>
          ))}
        </span>
      )}
      <ChevronDown className="w-3.5 h-3.5 text-stone-400 flex-shrink-0 ml-auto" />
    </button>
  );
}

/** Compact label for a module chip. MODULE_LABELS are long — this
 *  chops them so 3 modules still fit in a table cell. */
function shortLabelFor(m: string): string {
  const short: Record<string, string> = {
    PROGRESS: "Progress",
    QAQC: "QA/QC",
    SAFETY: "Safety",
    HINDRANCE: "Hindrance",
    CONCERN: "Concern",
    PERMIT: "Permit",
  };
  return short[m] ?? m;
}

/**
 * Small modal dialog for editing a user's module scope. Local state
 * lives in the parent (pendingModules) so a stray Cancel doesn't lose
 * changes if the user goes back. Save fires the PATCH; Cancel closes.
 * "Full access" button clears every module — the same as unchecking
 * everything and saving.
 */
function ModulesPickerDialog({
  user,
  pending,
  onToggle,
  onSave,
  onClearAll,
  onClose,
}: {
  user: UserRow;
  pending: Set<ModuleKey>;
  onToggle: (m: ModuleKey) => void;
  onSave: () => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const scopeSummary = pending.size === 0 ? "Full access (all modules)" : `Scoped to ${pending.size} of ${ALL_MODULES.length}`;
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
          <h2 className="text-sm font-semibold text-stone-900">
            Modules for {user.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-900 p-1 rounded-md hover:bg-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-stone-500 leading-snug">
            Leave every module unchecked for full access (internal staff, sees
            everything). Check specific modules to scope this user — they&apos;ll
            only see mobile tools + records tagged with those modules.
          </p>
          <div className="space-y-1.5">
            {ALL_MODULES.map((m) => {
              const checked = pending.has(m);
              return (
                <label
                  key={m}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 cursor-pointer hover:bg-stone-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(m)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-stone-900">
                      {MODULE_LABELS[m] ?? m}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-stone-500 italic">{scopeSummary}</div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-5 py-3">
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-stone-600 hover:text-stone-900 underline-offset-2 hover:underline"
          >
            Clear all (full access)
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="text-xs font-semibold rounded-md bg-stone-900 text-white px-3 py-1.5 hover:bg-stone-800"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Generate a memorable-but-strong password. Word-based passwords (three
 * random dictionary words separated by a dash) are easier for a team
 * member to type from a piece of paper or SMS than a random alphanumeric
 * blob, and still have plenty of entropy against automated attacks —
 * three words from a 40-word list is ~15 bits, plus a random 4-digit
 * suffix is another ~13 bits, ~28 bits total per generated password
 * (roughly 250 million combinations). We're relying on rate-limiting +
 * the timing-attack mitigation for online-attack resistance; a truly
 * targeted offline attack would need the bcrypt hashes, which never
 * leave the DB.
 */
function generateFriendlyPassword(): string {
  const words = [
    "acacia", "banyan", "canopy", "delta", "estuary", "forest", "granite",
    "harbor", "island", "juniper", "kestrel", "lantern", "mango", "neem",
    "orchid", "pebble", "quartz", "river", "saffron", "teak", "umbra",
    "veranda", "willow", "yarrow", "zenith", "amber", "basil", "cedar",
    "dune", "ember", "fern", "grove", "hollow", "ivory", "jade",
    "kite", "linen", "marble", "nectar", "opal",
  ];
  // window.crypto is available on all modern browsers; only guard against
  // the (impossible in this codepath) SSR case.
  const rng = typeof window !== "undefined" && window.crypto?.getRandomValues
    ? (max: number) => {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] % max;
      }
    : (max: number) => Math.floor(Math.random() * max);
  const w1 = words[rng(words.length)];
  const w2 = words[rng(words.length)];
  const w3 = words[rng(words.length)];
  const suffix = String(rng(10000)).padStart(4, "0");
  return `${w1}-${w2}-${w3}-${suffix}`;
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
  // When admin uses "Generate", we reveal the password (so they can eyeball
  // it before sending) and offer copy-to-clipboard. Typed passwords stay
  // masked as before — this only toggles when generateFriendlyPassword ran.
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user) return null;

  function onGenerate() {
    const next = generateFriendlyPassword();
    setPw(next);
    setConfirm(next);
    setGenerated(true);
    setCopied(false);
    setError(null);
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some browsers / iframes; the input is
      // visible so admin can select manually as a fallback.
      setError("Couldn't copy — select the password above and copy manually.");
    }
  }

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
          <button
            type="button"
            onClick={onGenerate}
            className="w-full text-xs font-medium rounded-md border border-stone-300 bg-stone-50 py-1.5 hover:bg-stone-100"
          >
            ⟳ Generate strong password
          </button>
          <label className="block">
            <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
              New password
            </span>
            <div className="mt-1 flex gap-2">
              <input
                // Reveal when generated so admin can see + verify what they're
                // about to send; typed passwords stay masked for shoulder-surfing.
                type={generated ? "text" : "password"}
                required
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  // Typing invalidates the "generated" state so the field
                  // re-masks and the copy button hides — matches user intent.
                  setGenerated(false);
                }}
                className="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-stone-900"
              />
              {generated && (
                <button
                  type="button"
                  onClick={onCopy}
                  className="text-xs rounded-md border border-stone-300 bg-white px-3 hover:bg-stone-50 whitespace-nowrap"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              )}
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-stone-700 uppercase tracking-wider">
              Confirm new password
            </span>
            <input
              type={generated ? "text" : "password"}
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
