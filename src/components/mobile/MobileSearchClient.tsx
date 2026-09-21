"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Search as SearchIcon,
  Layers,
  Bug,
  HelpCircle,
  MessageSquare,
  AlertTriangle,
  ShieldCheck,
  ClipboardList,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MobileSearchResult } from "@/lib/mobileSearch";

/**
 * Client-side search UX. Debounces the input, hits `/api/mobile-search`,
 * groups the results by type. Empty state teaches the search: "Try 'V15
 * concreting'" — one useful example beats generic filler.
 *
 * Autofocus on mount so the keyboard pops immediately — the user came to
 * this page to type, not to look.
 */
export default function MobileSearchClient({ projectId }: { projectId: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MobileSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce — 220ms is snappy enough that fast typers don't feel the wait
  // but slow enough to let a real word land before firing a query.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);

  const runSearch = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setResult(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/mobile-search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as MobileSearchResult;
        setResult(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void runSearch(debounced);
  }, [debounced, runSearch]);

  return (
    <div className="flex-1 flex flex-col bg-ivory min-h-0">
      {/* Hero band + search input. The input is native so the mobile
          keyboard's "Search" button behaves. */}
      <div
        className="px-5 pt-5 pb-4 border-b border-sandstone-100"
        style={{ background: "linear-gradient(180deg, var(--color-sandstone-50) 0%, var(--color-ivory) 100%)" }}
      >
        <p className="font-serif italic text-[13px] text-ferrous-600 tracking-wide">
          Find anything
        </p>
        <h1 className="font-serif text-[26px] leading-tight text-ink tracking-tight mt-0.5">
          Search
        </h1>

        <label className="mt-4 block relative">
          <SearchIcon className="w-4 h-4 text-ink-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            enterKeyHint="search"
            placeholder="Try 'V15 concreting', 'RFI-0012', or 'honeycombing'"
            className="w-full rounded-full border border-sandstone-200 bg-white pl-9 pr-3 py-2.5 text-[15px] placeholder:text-ink-3/70 focus:outline-none focus:ring-2 focus:ring-ferrous-500/30"
          />
          {loading && (
            <Loader2 className="w-4 h-4 text-ink-3 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
          )}
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {q.trim().length === 0 && (
          <EmptyStart />
        )}
        {q.trim().length === 1 && (
          <div className="text-[13px] text-ink-3 leading-snug px-1">
            Keep typing — search kicks in from two characters.
          </div>
        )}
        {error && q.trim().length >= 2 && (
          <div className="rounded-lg bg-red-50 ring-1 ring-red-200 text-red-700 text-xs p-3">
            {error}
          </div>
        )}
        {result && q.trim().length >= 2 && result.total === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
            <SearchIcon className="w-6 h-6 text-stone-300 mx-auto" />
            <p className="text-sm text-stone-500 mt-2">
              Nothing matched &ldquo;{q.trim()}&rdquo;. Try a shorter word or a villa number.
            </p>
          </div>
        )}

        {result && result.total > 0 && (
          <>
            {result.activities.length > 0 && (
              <ResultSection title="Activities" count={result.activities.length} icon={Layers}>
                {result.activities.map((a) => (
                  <ResultRow
                    key={a.id}
                    href={`/mobile/${projectId}/activity/${a.id}`}
                    primary={a.name}
                    secondary={metaLine(
                      a.blockCode ? `Block ${a.blockCode}` : null,
                      a.villaLabel ?? null,
                      a.sectionName ?? null,
                    )}
                    right={a.taskCode}
                  />
                ))}
              </ResultSection>
            )}

            {result.snags.length > 0 && (
              <ResultSection title="Snags & defects" count={result.snags.length} icon={Bug}>
                {result.snags.map((s) => (
                  <ResultRow
                    key={s.id}
                    href={`/mobile/${projectId}/issue/${s.id}?tab=${statusToIssueTab(s.status)}`}
                    primary={s.description}
                    secondary={metaLine(statusLabel(s.status))}
                    right={s.severity ?? undefined}
                  />
                ))}
              </ResultSection>
            )}

            {result.rfis.length > 0 && (
              <ResultSection title="RFIs" count={result.rfis.length} icon={HelpCircle}>
                {result.rfis.map((r) => (
                  <ResultRow
                    key={r.id}
                    href={`/mobile/${projectId}/rfi/${r.id}?tab=${statusToRfiTab(r.status)}`}
                    label={r.display}
                    primary={r.subject}
                    secondary={metaLine(statusLabel(r.status))}
                  />
                ))}
              </ResultSection>
            )}

            {result.inspections.length > 0 && (
              <ResultSection title="WIRs" count={result.inspections.length} icon={ClipboardList}>
                {result.inspections.map((i) => (
                  <ResultRow
                    key={i.id}
                    href={`/mobile/${projectId}/qaqc/${i.id}${i.module ? `?module=${i.module}` : ""}`}
                    primary={i.title}
                    secondary={metaLine(statusLabel(i.status), i.module === "SAFETY" ? "EHS" : i.module === "QAQC" ? "QA/QC" : null)}
                  />
                ))}
              </ResultSection>
            )}

            {result.concerns.length > 0 && (
              <ResultSection title="Concerns" count={result.concerns.length} icon={MessageSquare}>
                {result.concerns.map((c) => (
                  <ResultRow
                    key={c.id}
                    href={`/mobile/${projectId}/concern/${c.id}?tab=${statusToConcernTab(c.status)}`}
                    primary={c.description}
                    secondary={metaLine(statusLabel(c.status))}
                  />
                ))}
              </ResultSection>
            )}

            {result.hindrances.length > 0 && (
              <ResultSection title="Hindrances" count={result.hindrances.length} icon={AlertTriangle}>
                {result.hindrances.map((h) => (
                  <ResultRow
                    key={h.id}
                    href={`/mobile/${projectId}/hindrance/${h.id}?tab=${h.status === "RESOLVED" ? "resolved" : "open"}`}
                    primary={h.description}
                    secondary={metaLine(statusLabel(h.status))}
                  />
                ))}
              </ResultSection>
            )}

            {result.permits.length > 0 && (
              <ResultSection title="Work permits" count={result.permits.length} icon={ShieldCheck}>
                {result.permits.map((p) => (
                  <ResultRow
                    key={p.id}
                    href={`/mobile/${projectId}/permit/${p.id}`}
                    label={p.typeLabel}
                    primary={p.title}
                    secondary={metaLine(statusLabel(p.status))}
                  />
                ))}
              </ResultSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyStart() {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6">
      <p className="text-[13px] text-ink-3 leading-relaxed">
        Search hits activities (by villa number, name or task code), snags,
        RFIs, WIRs, concerns, hindrances and work permits — all in one go.
      </p>
      <ul className="mt-3 space-y-1.5 text-[13px] text-ink-3">
        <li>· <span className="text-ink font-medium">V15</span> or <span className="text-ink font-medium">Villa 15</span> — activities on a villa</li>
        <li>· <span className="text-ink font-medium">RFI-0012</span> — jump straight to an RFI</li>
        <li>· <span className="text-ink font-medium">honeycombing</span> — snags mentioning it</li>
      </ul>
    </div>
  );
}

function ResultSection({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon className="w-4 h-4 text-ferrous-600" />
        <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-[0.14em]">
          {title}
        </span>
        <span className="rounded-full bg-sandstone-100 text-ink-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums min-w-[18px] text-center">
          {count}
        </span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function ResultRow({
  href,
  label,
  primary,
  secondary,
  right,
}: {
  href: string;
  label?: string;
  primary: string;
  secondary?: string;
  right?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="rounded-2xl border border-sandstone-100 bg-cream shadow-soft p-3.5 block active:bg-sandstone-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {label && (
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ferrous-600 mb-0.5">
                {label}
              </div>
            )}
            <div className="text-[14px] text-ink leading-snug line-clamp-2">
              {primary}
            </div>
            {secondary && (
              <div className="text-[11.5px] text-ink-3 mt-1">{secondary}</div>
            )}
          </div>
          {right && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-2 shrink-0 mt-0.5">
              {right}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function metaLine(...bits: (string | undefined | null)[]): string | undefined {
  const parts = bits.filter((b): b is string => !!b && b.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}
function statusLabel(status: string): string {
  return {
    OPEN: "Open",
    RESOLVED: "Resolved",
    IN_REINSPECTION: "In reinspection",
    PENDING: "Pending",
    READ: "Read",
    TASK_ASSIGNED: "Assigned",
    ANSWERED: "Answered",
    CLOSED: "Closed",
    IN_REVIEW: "In review",
    PASSED: "Passed",
    REJECTED: "Rejected",
    APPROVED: "Approved",
  }[status] ?? status;
}
function statusToIssueTab(status: string): string {
  if (status === "IN_REINSPECTION") return "reinspection";
  if (status === "RESOLVED") return "resolved";
  return "open";
}
function statusToRfiTab(status: string): string {
  if (status === "ANSWERED") return "answered";
  if (status === "CLOSED") return "closed";
  return "open";
}
function statusToConcernTab(status: string): string {
  if (status === "READ") return "read";
  if (status === "TASK_ASSIGNED") return "task_assigned";
  if (status === "RESOLVED") return "resolved";
  return "pending";
}
