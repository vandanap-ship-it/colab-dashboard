"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Clock, Loader2, Search, X, Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface PickerMilestone {
  id: string;
  name: string;
  code: string;
  pctComplete: number;
  done: boolean;
}
interface PickerVilla {
  id: string;
  number: number;
  label: string;
  milestones: PickerMilestone[];
}
interface PickerBlock {
  code: string;
  name: string | null;
  villas: PickerVilla[];
}
interface RecentActivity {
  id: string;
  name: string;
  taskCode: string;
  villaLabel: string;
  blockCode: string;
  sectionName: string;
}
interface PickerData {
  blocks: PickerBlock[];
  recent: RecentActivity[];
}

interface LeafActivity {
  id: string;
  name: string;
  taskCode: string;
  percentComplete: number;
  isStar: boolean;
  started: boolean;
  done: boolean;
  totalQuantity: number | null;
  unit: string | null;
  contractor: { id: string; name: string } | null;
}

export interface ActivityPickerProps {
  projectId: string;
  /** Called when the user commits to an activity. */
  onPick: (activity: {
    id: string;
    name: string;
    taskCode: string;
    totalQuantity: number | null;
    unit: string | null;
    contractor: { id: string; name: string } | null;
    path: { blockCode: string; villaLabel: string; sectionName: string };
  }) => void;
  /** Preselect a specific activity id on mount (e.g. deep-link). */
  initialActivityId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = "root" | "block" | "villa" | "milestone" | "activity";

export default function ActivityPicker({ projectId, onPick, initialActivityId }: ActivityPickerProps) {
  const [data, setData] = useState<PickerData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("root");
  const [blockCode, setBlockCode] = useState<string | null>(null);
  const [villaId, setVillaId] = useState<string | null>(null);
  const [villaMilestoneId, setVillaMilestoneId] = useState<string | null>(null);
  const [activities, setActivities] = useState<LeafActivity[] | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [freeText, setFreeText] = useState("");

  // ------- initial index load -------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/activities/picker`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Picker fetch failed: ${res.status}`);
        const d = (await res.json()) as PickerData;
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load activities");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // ------- fetch leaf activities when a milestone is chosen -------
  useEffect(() => {
    if (step !== "activity" || !villaMilestoneId) return;
    let cancelled = false;
    setActivitiesLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/activities/for-milestone/${villaMilestoneId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const d = (await res.json()) as { activities: LeafActivity[] };
        if (!cancelled) setActivities(d.activities);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load activities");
      } finally {
        if (!cancelled) setActivitiesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, villaMilestoneId, projectId]);

  // ------- free-text search across all levels -------
  const searchMatches = useMemo(() => {
    if (!data || freeText.trim().length < 2) return null;
    const q = freeText.trim().toLowerCase();
    const results: Array<{
      villaMilestoneId: string;
      blockCode: string;
      villaLabel: string;
      villaId: string;
      sectionName: string;
    }> = [];
    for (const b of data.blocks) {
      for (const v of b.villas) {
        for (const m of v.milestones) {
          const hay = `${b.code} ${v.label} ${m.name}`.toLowerCase();
          if (hay.includes(q)) {
            results.push({
              villaMilestoneId: m.id,
              blockCode: b.code,
              villaLabel: v.label,
              villaId: v.id,
              sectionName: m.name,
            });
          }
        }
      }
    }
    return results.slice(0, 30);
  }, [data, freeText]);

  // ------- helpers -------
  const currentBlock = useMemo(
    () => data?.blocks.find((b) => b.code === blockCode) ?? null,
    [data, blockCode],
  );
  const currentVilla = useMemo(
    () => currentBlock?.villas.find((v) => v.id === villaId) ?? null,
    [currentBlock, villaId],
  );
  const currentMilestone = useMemo(
    () => currentVilla?.milestones.find((m) => m.id === villaMilestoneId) ?? null,
    [currentVilla, villaMilestoneId],
  );

  const goBack = useCallback(() => {
    if (step === "activity") { setStep("milestone"); setActivities(null); setVillaMilestoneId(null); return; }
    if (step === "milestone") { setStep("villa"); setVillaId(null); return; }
    if (step === "villa") { setStep("block"); setBlockCode(null); return; }
    if (step === "block") { setStep("root"); return; }
  }, [step]);

  const jumpToMilestone = useCallback((match: { blockCode: string; villaId: string; villaMilestoneId: string }) => {
    setBlockCode(match.blockCode);
    setVillaId(match.villaId);
    setVillaMilestoneId(match.villaMilestoneId);
    setStep("activity");
    setFreeText("");
  }, []);

  const pickRecent = useCallback(async (r: RecentActivity) => {
    // Fetch the activity's full metadata (totalQuantity, unit, contractor)
    // so the calling form has what it needs to render.
    // The recent list itself doesn't carry those.
    try {
      const res = await fetch(`/api/projects/${projectId}/wbs?leaves=true`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch activity details");
      const j = (await res.json()) as { nodes: Array<{ id: string; name: string; taskCode: string; totalQuantity: number | null; unit: string | null; contractor: { id: string; name: string } | null }> };
      const node = j.nodes.find((n) => n.id === r.id);
      if (!node) return;
      onPick({
        id: node.id,
        name: node.name,
        taskCode: node.taskCode,
        totalQuantity: node.totalQuantity,
        unit: node.unit,
        contractor: node.contractor,
        path: { blockCode: r.blockCode, villaLabel: r.villaLabel, sectionName: r.sectionName },
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to pick");
    }
  }, [projectId, onPick]);

  const pickLeaf = useCallback((leaf: LeafActivity) => {
    if (!currentBlock || !currentVilla || !currentMilestone) return;
    onPick({
      id: leaf.id,
      name: leaf.name,
      taskCode: leaf.taskCode,
      totalQuantity: leaf.totalQuantity,
      unit: leaf.unit,
      contractor: leaf.contractor,
      path: {
        blockCode: currentBlock.code,
        villaLabel: currentVilla.label,
        sectionName: currentMilestone.name,
      },
    });
  }, [currentBlock, currentVilla, currentMilestone, onPick]);

  // Deep-link (initialActivityId): future work. Resolving an activity id to
  // its {block, villa, milestone} path needs a lookup endpoint we don't have
  // yet. For now the deep-link value is accepted but ignored, and the user
  // sees the root drilldown.
  void initialActivityId;

  // ------- render -------
  if (loadError) {
    return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>;
  }
  if (!data) {
    return (
      <div className="rounded-md border border-stone-200 bg-white p-6 text-center">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
        <p className="text-xs text-stone-500 mt-2">Loading activities…</p>
      </div>
    );
  }

  // Free-text search overrides the drilldown.
  if (searchMatches !== null) {
    return (
      <div className="space-y-3">
        <SearchBar value={freeText} onChange={setFreeText} onClear={() => setFreeText("")} />
        {searchMatches.length === 0 ? (
          <div className="text-xs text-stone-500 italic px-2 py-6 text-center">No matches. Try a block or villa number.</div>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-md border border-stone-200 bg-white max-h-72 overflow-y-auto">
            {searchMatches.map((m) => (
              <li key={m.villaMilestoneId}>
                <button
                  type="button"
                  onClick={() => jumpToMilestone(m)}
                  className="w-full text-left px-3 py-2.5 hover:bg-stone-50 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-stone-900 truncate">{m.sectionName}</div>
                    <div className="text-[11px] text-stone-500">Block {m.blockCode} · {m.villaLabel}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Breadcrumb + back */}
      {step !== "root" && (
        <button
          type="button"
          onClick={goBack}
          className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          {step === "block" ? "Back" : step === "villa" ? `Block ${currentBlock?.code}` : step === "milestone" ? currentVilla?.label : currentMilestone?.name}
        </button>
      )}

      {/* Root — recent picks + entry to drilldown + search */}
      {step === "root" && (
        <>
          <SearchBar value={freeText} onChange={setFreeText} onClear={() => setFreeText("")} />

          {data.recent.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500 mb-1.5">
                <Clock className="w-3 h-3" />
                Recently used
              </div>
              <ul className="space-y-1">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pickRecent(r)}
                      className="w-full text-left rounded-md border border-stone-200 bg-white px-3 py-2 hover:bg-stone-50"
                    >
                      <div className="text-sm font-medium text-stone-900 truncate">{r.name}</div>
                      <div className="text-[11px] text-stone-500 truncate">Block {r.blockCode} · {r.villaLabel} · {r.sectionName}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => setStep("block")}
            className="w-full rounded-md border-2 border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 hover:border-stone-500"
          >
            <Sparkles className="w-4 h-4 inline mr-1.5 text-amber-500" />
            Pick by location →
          </button>
        </>
      )}

      {/* Block level */}
      {step === "block" && (
        <TileGrid
          items={data.blocks.map((b) => ({
            key: b.code,
            label: `Block ${b.code}`,
            sub: `${b.villas.length} villa${b.villas.length === 1 ? "" : "s"}`,
            onClick: () => { setBlockCode(b.code); setStep("villa"); },
          }))}
        />
      )}

      {/* Villa level */}
      {step === "villa" && currentBlock && (
        <TileGrid
          items={currentBlock.villas.map((v) => ({
            key: v.id,
            label: v.label,
            sub: `${v.milestones.length} milestones`,
            onClick: () => { setVillaId(v.id); setStep("milestone"); },
          }))}
        />
      )}

      {/* Milestone level */}
      {step === "milestone" && currentVilla && (
        <ul className="divide-y divide-stone-100 rounded-md border border-stone-200 bg-white max-h-96 overflow-y-auto">
          {currentVilla.milestones.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => { setVillaMilestoneId(m.id); setStep("activity"); }}
                className="w-full text-left px-3 py-2.5 hover:bg-stone-50 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-900 truncate">{m.name}</div>
                  <div className="text-[11px] text-stone-500">{m.pctComplete}% done{m.done ? " · closed" : ""}</div>
                </div>
                <div className="w-14 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div className={`h-full ${m.done ? "bg-emerald-500" : m.pctComplete > 0 ? "bg-amber-500" : "bg-stone-300"}`} style={{ width: `${m.pctComplete}%` }} />
                </div>
                <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Activity (leaf) level */}
      {step === "activity" && (
        activitiesLoading ? (
          <div className="rounded-md border border-stone-200 bg-white p-6 text-center">
            <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto" />
            <p className="text-xs text-stone-500 mt-2">Loading activities…</p>
          </div>
        ) : !activities || activities.length === 0 ? (
          <div className="text-xs text-stone-500 italic px-2 py-6 text-center">No activities under this milestone.</div>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-md border border-stone-200 bg-white max-h-96 overflow-y-auto">
            {activities.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => pickLeaf(a)}
                  className="w-full text-left px-3 py-2.5 hover:bg-stone-50 flex items-start gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-900 flex items-center gap-1.5">
                      {a.isStar && <span className="text-amber-500" title="Star milestone">★</span>}
                      <span className="truncate">{a.name}</span>
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {a.percentComplete}% {a.done ? "done" : a.started ? "in progress" : "not started"}
                      {a.contractor && <> · {a.contractor.name}</>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-400 flex-shrink-0 mt-0.5" />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchBar({ value, onChange, onClear }: { value: string; onChange: (v: string) => void; onClear: () => void }) {
  return (
    <label className="relative block">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by block or villa (e.g. B04 or V12 Plinth)…"
        className="w-full pl-9 pr-9 py-2 rounded-md border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-900"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </label>
  );
}

function TileGrid({ items }: { items: Array<{ key: string; label: string; sub: string; onClick: () => void }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={it.onClick}
          className="rounded-md border border-stone-200 bg-white px-3 py-2.5 text-left hover:border-stone-500 hover:bg-stone-50"
        >
          <div className="text-sm font-semibold text-stone-900">{it.label}</div>
          <div className="text-[10px] text-stone-500 mt-0.5">{it.sub}</div>
        </button>
      ))}
    </div>
  );
}
