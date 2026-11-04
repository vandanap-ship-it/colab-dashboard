"use client";

import { useMemo, useState } from "react";
import styles from "./executive.module.css";
import type { DelayReasonCluster } from "@/lib/delayReasons";

export interface DelayReasonsCardProps {
  overall: DelayReasonCluster[];
}

/**
 * Dashboard "Delay Reason Clusters" card.
 *
 * Overall-only view (the By-contractor toggle was removed on 2026-11-04 -
 * Vandana management review; contractor attribution lives on the
 * Contractor Scope Health table above).
 *
 * The "Other" reason code gets an expander because 111+ entries hiding
 * under one label isn't useful - clicking it reveals the verbatim sub-
 * phrases the site team wrote in reasonNote, so management can see what
 * "Other" actually means on the ground.
 */
export default function DelayReasonsCard({ overall }: DelayReasonsCardProps) {
  const totalOpen = overall.reduce((n, r) => n + r.count, 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Delay Reason Clusters</h3>
        <span className={styles.meta}>
          every delay tagged by the site team · Siddhi + Colab combined · {totalOpen.toLocaleString("en-IN")} total
        </span>
      </div>
      <div className={styles.cardBd}>
        {totalOpen === 0 ? (
          <div className={styles.drEmpty}>
            No delay reasons logged yet. The site team tags each delayed
            progress entry with a reason (change order, material, labour,
            weather...); once any are logged, they cluster here by root cause.
          </div>
        ) : (
          <ReasonList clusters={overall} />
        )}
      </div>
    </div>
  );
}

function ReasonList({ clusters }: { clusters: DelayReasonCluster[] }) {
  const maxCount = Math.max(...clusters.map((c) => c.count), 1);
  return (
    <div className={styles.drList}>
      {clusters.map((c) => (
        <ReasonRow key={c.code} c={c} maxCount={maxCount} />
      ))}
    </div>
  );
}

function ReasonRow({ c, maxCount }: { c: DelayReasonCluster; maxCount: number }) {
  // "Other" rows get an expander that breaks down the underlying
  // reasonNote text into its most-repeated phrases. Everything else
  // renders as the compact row with a representative sample note.
  const isCatchAll = c.code === "OTHER";
  const hasNotes = c.subPhrases && c.subPhrases.length > 0;
  const expandable = isCatchAll && hasNotes;
  const [open, setOpen] = useState(false);

  // Merged-from codes appear as a small badge next to the label so viewers
  // see which raw reason codes were folded into this group.
  const mergedFrom = (c.mergedFrom ?? []).filter((raw) => raw !== c.code);
  const mergedTooltip = mergedFrom.length > 0
    ? `Includes: ${mergedFrom.join(", ")}`
    : undefined;

  const bar = (
    <div className={styles.drBar}>
      <div className={styles.drBarFill} style={{ width: `${(c.count / maxCount) * 100}%` }} />
    </div>
  );

  return (
    <div className={styles.drRow}>
      <div className={styles.drHd}>
        <span className={styles.drLabel}>
          {c.label}
          {mergedFrom.length > 0 && (
            <span className={styles.drMergeBadge} title={mergedTooltip}>
              {mergedFrom.length === 1 ? "merged · 1 code" : `merged · ${mergedFrom.length + 1} codes`}
            </span>
          )}
          {expandable && (
            <button
              type="button"
              className={styles.drExpandBtn}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "hide breakdown" : "see breakdown"}
            </button>
          )}
        </span>
        <span className={styles.drCount}>{c.count}</span>
      </div>
      {bar}
      <div className={styles.drMeta}>
        {c.daysImpact > 0 && (
          <>
            <span className={styles.drImpact}>+{c.daysImpact}d</span>
            <span className={styles.drSep}>·</span>
          </>
        )}
        <span className={styles.drSince}>
          latest {c.latestAt ? fmtDate(new Date(c.latestAt)) : "-"}
        </span>
        {c.sampleNote && !expandable && (
          <>
            <span className={styles.drSep}>·</span>
            <span className={styles.drNote} title={c.sampleNote}>&ldquo;{c.sampleNote}&rdquo;</span>
          </>
        )}
      </div>
      {expandable && open && c.subPhrases && (
        <SubPhraseList phrases={c.subPhrases} />
      )}
    </div>
  );
}

function SubPhraseList({ phrases }: { phrases: NonNullable<DelayReasonCluster["subPhrases"]> }) {
  const top = useMemo(
    () => [...phrases].sort((a, b) => b.count - a.count),
    [phrases],
  );
  const max = Math.max(...top.map((p) => p.count), 1);
  return (
    <div className={styles.drSubList}>
      <div className={styles.drSubHd}>What the site team actually wrote</div>
      {top.map((p) => (
        <div key={p.phrase} className={styles.drSubRow}>
          <div className={styles.drSubBar}>
            <div className={styles.drSubFill} style={{ width: `${(p.count / max) * 100}%` }} />
          </div>
          <div className={styles.drSubLbl}>{p.phrase}</div>
          <div className={styles.drSubCount}>{p.count}</div>
        </div>
      ))}
    </div>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
