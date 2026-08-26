"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "./Toast";

interface AssignInfo {
  totalActivities: number;
  untaggedActivities: number;
  contractors: { id: string; name: string }[];
  blockCodes: string[];
}

type Scope = "untagged" | "block" | "villa" | "all";

export default function ContractorAssignConsole({ projectId }: { projectId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [info, setInfo] = useState<AssignInfo | null>(null);
  const [contractorId, setContractorId] = useState("");
  const [scope, setScope] = useState<Scope>("untagged");
  const [blockCode, setBlockCode] = useState("");
  const [villaNumber, setVillaNumber] = useState<string>("");
  const [overrideConfirm, setOverrideConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/contractor-assign`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInfo(data);
      if (!contractorId && data.contractors[0]) setContractorId(data.contractors[0].id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    }
  }, [projectId, contractorId, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleAssign() {
    if (!contractorId) return;
    if (scope === "all" && !overrideConfirm) {
      toast.warning("Confirm the override checkbox — this overwrites existing tags.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/contractor-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractorId,
          scope,
          blockCode: scope === "block" ? blockCode : undefined,
          villaNumber: scope === "villa" ? Number(villaNumber) : undefined,
          override: scope === "all" ? true : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? `Failed (${res.status})`);
      } else {
        setLastResult(`Assigned ${data.updated} activities to ${data.contractor}.`);
        toast.success(`Assigned ${data.updated} activities.`);
        setOverrideConfirm(false);
        await load();
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setPending(false);
    }
  }

  if (!info) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
        <p className="text-sm text-stone-500 mt-2">Loading project state…</p>
      </div>
    );
  }

  const untaggedPct = info.totalActivities > 0
    ? Math.round((info.untaggedActivities / info.totalActivities) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">Total WBS activities</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{info.totalActivities.toLocaleString()}</div>
        </div>
        <div className={`rounded-lg border p-4 ${info.untaggedActivities > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`}>
          <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${info.untaggedActivities > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            Currently untagged
          </div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${info.untaggedActivities > 0 ? "text-amber-900" : "text-emerald-900"}`}>
            {info.untaggedActivities.toLocaleString()}
            <span className="ml-2 text-sm font-medium opacity-70">({untaggedPct}%)</span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Contractor</span>
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {info.contractors.length === 0 && <option value="">No contractors on this project</option>}
            {info.contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-stone-700">Scope</legend>
          <div className="mt-2 space-y-2">
            <ScopeOption
              current={scope}
              value="untagged"
              onChange={setScope}
              title="Untagged only"
              desc={`Apply to every activity currently without a contractor (${info.untaggedActivities.toLocaleString()}). Safest.`}
            />
            <ScopeOption
              current={scope}
              value="block"
              onChange={setScope}
              title="One block, untagged only"
              desc="Restrict to a specific block. Skips already-tagged rows in that block."
            >
              {scope === "block" && (
                <select
                  value={blockCode}
                  onChange={(e) => setBlockCode(e.target.value)}
                  className="mt-2 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">Pick a block…</option>
                  {info.blockCodes.map((c) => (
                    <option key={c} value={c}>Block {c}</option>
                  ))}
                </select>
              )}
            </ScopeOption>
            <ScopeOption
              current={scope}
              value="villa"
              onChange={setScope}
              title="One villa, untagged only"
              desc="Restrict to a specific villa number."
            >
              {scope === "villa" && (
                <input
                  type="number"
                  min={1}
                  value={villaNumber}
                  onChange={(e) => setVillaNumber(e.target.value)}
                  placeholder="e.g. 12"
                  className="mt-2 w-24 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
                />
              )}
            </ScopeOption>
            <ScopeOption
              current={scope}
              value="all"
              onChange={setScope}
              title="ALL activities (overrides existing)"
              desc="Reassign every activity in the project. Overwrites current contractor tags. Use with care."
            >
              {scope === "all" && (
                <label className="mt-2 inline-flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-900">
                  <input
                    type="checkbox"
                    checked={overrideConfirm}
                    onChange={(e) => setOverrideConfirm(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I understand this overwrites all existing contractor tags for {info.totalActivities.toLocaleString()} activities.</span>
                </label>
              )}
            </ScopeOption>
          </div>
        </fieldset>

        <div className="pt-2">
          <button
            type="button"
            onClick={handleAssign}
            disabled={pending || !contractorId || (scope === "block" && !blockCode) || (scope === "villa" && !villaNumber) || (scope === "all" && !overrideConfirm)}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 text-white text-sm font-medium px-4 py-2 hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {pending ? "Assigning…" : "Assign contractor"}
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-2 text-sm text-emerald-900">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {lastResult}
        </div>
      )}

      <div className="rounded-md bg-stone-50 border border-stone-200 px-4 py-3 text-xs text-stone-600 flex gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-stone-500" />
        <div>
          <strong>Reminder:</strong> per-contractor sections of the Master Report,
          Weekly Report, and Dashboard all read <code>WBSNode.contractorId</code>.
          Untagged activities are excluded from those groupings.
        </div>
      </div>
    </div>
  );
}

function ScopeOption({
  current,
  value,
  onChange,
  title,
  desc,
  children,
}: {
  current: Scope;
  value: Scope;
  onChange: (v: Scope) => void;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  const active = current === value;
  return (
    <label className={`block rounded-md border px-4 py-3 cursor-pointer transition-colors ${active ? "border-stone-900 bg-stone-50" : "border-stone-200 hover:border-stone-300"}`}>
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="scope"
          value={value}
          checked={active}
          onChange={() => onChange(value)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="text-sm font-semibold text-stone-900">{title}</div>
          <div className="text-xs text-stone-500 mt-0.5">{desc}</div>
          {children}
        </div>
      </div>
    </label>
  );
}
