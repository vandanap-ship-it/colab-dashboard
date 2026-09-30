"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

/**
 * Colab-parity template picker — the first screen a filler sees after
 * tapping "Inspection Checklist" from the FAB sheet. Matches Colab
 * native: title "Add Checklist" with a back arrow, two tabs
 * (Manual · Activity), a search input, and a scrolling list of template
 * cards. Each card has a dark title header, a description box, and an
 * "Add Checklist" button.
 *
 * Selecting a template navigates to the WIR form with `?templateId=…`
 * pre-filled, so the form knows which template's items to seed.
 *
 * Activity tab: location-first filter — Villa → Sub Location → Activity
 * Head. Once those are picked, templates filter to that scope. For
 * launch we render the Villa + Activity Head dropdowns (which drive
 * server-side filtering later) but the current Manual tab already has
 * everything a filler needs day-1; Activity is the parity shell so
 * muscle memory works.
 */

type Template = {
  id: string;
  code: string;
  name: string;
  activity: string | null;
  module: string | null;
  items: Array<{ seq: number; section: string | null; description: string }>;
};

type Villa = { id: string; number: number; label: string | null };

export default function WIRTemplatePickerScreen({
  projectId,
  wbsNodeId,
}: {
  projectId: string;
  wbsNodeId?: string | null;
}) {
  const [tab, setTab] = useState<"manual" | "activity">("manual");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Activity-tab filters
  const [villas, setVillas] = useState<Villa[]>([]);
  const [villaId, setVillaId] = useState<string>("");
  const [activityHead, setActivityHead] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inspection-templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        if (!cancelled) {
          setTemplates(d.templates ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/villas`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { villas: [] }))
      .then((d) => {
        if (!cancelled) setVillas(d.villas ?? []);
      })
      .catch(() => {
        if (!cancelled) setVillas([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = templates;
    if (tab === "activity") {
      // Activity-tab filter: match on activity string if head picked. Villa
      // is captured so the caller-side form can pre-fill location but does
      // not itself filter templates (templates are project-global).
      if (activityHead) {
        list = list.filter((t) =>
          (t.activity ?? "").toLowerCase().includes(activityHead.toLowerCase()),
        );
      } else {
        // Nothing picked → no results, mirroring Colab's Activity(0).
        list = [];
      }
    }
    if (!s) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        t.code.toLowerCase().includes(s) ||
        (t.activity ?? "").toLowerCase().includes(s),
    );
  }, [templates, tab, search, activityHead]);

  // Activity heads = distinct t.activity values across all templates.
  const activityHeads = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) {
      if (t.activity) set.add(t.activity);
    }
    return Array.from(set).sort();
  }, [templates]);

  return (
    <div className="mx-auto max-w-md p-4 pb-6 space-y-4">
      {/* Title — the outer mobile layout already carries a back arrow in
          its header strip, so the picker screen doesn't stack a second
          one below it. Shraddha 2026-09-30: "two back arrows" was the
          top-of-list complaint on this view. */}
      <h1 className="text-2xl font-bold text-ink">Add Checklist</h1>

      {/* Tabs */}
      <div className="border-b border-stone-200">
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => setTab("manual")}
            className={`pb-2 text-sm font-semibold ${
              tab === "manual"
                ? "border-b-2 border-ferrous-500 text-ink"
                : "text-stone-500"
            }`}
          >
            Manual
            <span className="ml-1 rounded-full bg-stone-100 px-1.5 text-[10px]">
              {tab === "manual" ? filtered.length : templates.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("activity")}
            className={`pb-2 text-sm font-semibold ${
              tab === "activity"
                ? "border-b-2 border-ferrous-500 text-ink"
                : "text-stone-500"
            }`}
          >
            Activity
            <span className="ml-1 rounded-full bg-stone-100 px-1.5 text-[10px]">
              {tab === "activity" ? filtered.length : 0}
            </span>
          </button>
        </div>
      </div>

      {tab === "manual" && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search checklist by name"
            className="w-full rounded-md border border-stone-200 bg-white pl-9 pr-3 py-2.5 text-sm"
          />
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-2">
          <select
            value={villaId}
            onChange={(e) => setVillaId(e.target.value)}
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="">Select Villa</option>
            {villas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label || `Villa ${String(v.number).padStart(2, "0")}`}
              </option>
            ))}
          </select>
          <select
            value={activityHead}
            onChange={(e) => setActivityHead(e.target.value)}
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="">Select Activity Head</option>
            {activityHeads.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p className="pt-4 text-center text-sm text-stone-500">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <p className="pt-4 text-center text-sm text-stone-500 italic">
          {tab === "activity"
            ? "Pick a Villa and Activity Head to see templates."
            : "No templates match your search."}
        </p>
      ) : (
        <ul className="space-y-3 pt-1">
          {filtered.map((t) => (
            <li
              key={t.id}
              className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
            >
              {/* Dark title header — Colab uses ink with white text. */}
              <div className="bg-ink px-4 py-3 text-white">
                <h3 className="text-base font-bold leading-tight">{t.name}</h3>
                {t.code ? (
                  <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/60">
                    {t.code}
                  </p>
                ) : null}
              </div>
              {/* Body — reduced from py-4 to py-3, Description label
                  left-aligned + smaller, and the border-around-the-body
                  toned from a shouty 2px amber dashed rule to a 1px
                  sandstone-100 dashed rule so the card reads calmer.
                  The description block content itself is unchanged
                  (name + item count), matching the Colab card shape. */}
              <div className="space-y-2 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                  Description
                </p>
                <div className="rounded-md border border-dashed border-sandstone-200 bg-white px-3 py-2 text-sm text-stone-600">
                  {t.name}
                  {t.items.length > 0 && (
                    <span className="text-stone-400">
                      {" "}
                      · {t.items.length} item{t.items.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="flex justify-center pt-1">
                  <Link
                    href={{
                      pathname: `/mobile/${projectId}/inspection/new`,
                      query: {
                        templateId: t.id,
                        ...(villaId ? { villaId } : {}),
                        ...(wbsNodeId ? { wbsNodeId } : {}),
                      },
                    }}
                    className="rounded-full bg-ink px-6 py-2 text-sm font-semibold text-white hover:bg-ink/90"
                  >
                    Add Checklist
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
