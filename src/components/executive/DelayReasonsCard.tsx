"use client";

import { useState } from "react";
import styles from "./executive.module.css";
import type { ContractorDelayReasonGroup, DelayReasonCluster } from "@/lib/delayReasons";

export interface DelayReasonsCardProps {
  overall: DelayReasonCluster[];
  byContractor: ContractorDelayReasonGroup[];
}

/**
 * Dashboard "Delay Reason Clusters" card with a segmented control that
 * flips between:
 *   - Overall: all reasons across the project, sorted by count desc
 *   - By contractor: reasons grouped under each contractor so admin can see
 *     which contractor is driving which cause
 *
 * The toggle is client-side only — both aggregations arrive from the server
 * component so there's no round-trip when flipping views.
 */
export default function DelayReasonsCard({ overall, byContractor }: DelayReasonsCardProps) {
  const [view, setView] = useState<"overall" | "byContractor">("overall");

  const totalOpen = overall.reduce((n, r) => n + r.count, 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Delay Reason Clusters</h3>
        <div className={styles.drToggle}>
          <span className={styles.meta}>
            open hindrances · site team tags at log-time
          </span>
          <div className={styles.drToggleGroup}>
            <button
              type="button"
              className={`${styles.drToggleBtn} ${view === "overall" ? styles.drToggleOn : ""}`}
              onClick={() => setView("overall")}
            >
              Overall
            </button>
            <button
              type="button"
              className={`${styles.drToggleBtn} ${view === "byContractor" ? styles.drToggleOn : ""}`}
              onClick={() => setView("byContractor")}
            >
              By contractor
            </button>
          </div>
        </div>
      </div>
      <div className={styles.cardBd}>
        {totalOpen === 0 ? (
          <div className={styles.drEmpty}>
            No open hindrances. Site team logs blockers with a reason tag —
            once any are open, they cluster here by root cause.
          </div>
        ) : view === "overall" ? (
          <ReasonList clusters={overall} />
        ) : (
          <ContractorGroupList groups={byContractor} />
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

function ContractorGroupList({ groups }: { groups: ContractorDelayReasonGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className={styles.drEmpty}>
        Open hindrances aren&apos;t linked to any contractor yet. Log with a WBS
        activity attached so this breakdown lights up.
      </div>
    );
  }
  return (
    <div className={styles.drContractorList}>
      {groups.map((g) => {
        const maxCount = Math.max(...g.reasons.map((r) => r.count), 1);
        return (
          <div key={g.contractorId ?? "__project__"} className={styles.drContractorGroup}>
            <div className={styles.drContractorHd}>
              <span className={styles.drContractorName}>{g.contractorName}</span>
              <span className={styles.drContractorMeta}>
                {g.totalCount} hindrance{g.totalCount === 1 ? "" : "s"}
                {g.totalDaysImpact > 0 && (
                  <> · <span className={styles.drImpact}>+{g.totalDaysImpact}d</span></>
                )}
              </span>
            </div>
            <div className={styles.drList}>
              {g.reasons.map((c) => (
                <ReasonRow key={c.code} c={c} maxCount={maxCount} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReasonRow({ c, maxCount }: { c: DelayReasonCluster; maxCount: number }) {
  return (
    <div className={styles.drRow}>
      <div className={styles.drHd}>
        <span className={styles.drLabel}>{c.label}</span>
        <span className={styles.drCount}>{c.count}</span>
      </div>
      <div className={styles.drBar}>
        <div
          className={styles.drBarFill}
          style={{ width: `${(c.count / maxCount) * 100}%` }}
        />
      </div>
      <div className={styles.drMeta}>
        {c.daysImpact > 0 && (
          <>
            <span className={styles.drImpact}>+{c.daysImpact}d</span>
            <span className={styles.drSep}>·</span>
          </>
        )}
        <span className={styles.drSince}>
          latest {c.latestAt ? fmtDate(new Date(c.latestAt)) : "—"}
        </span>
        {c.sampleNote && (
          <>
            <span className={styles.drSep}>·</span>
            <span className={styles.drNote} title={c.sampleNote}>“{c.sampleNote}”</span>
          </>
        )}
      </div>
    </div>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
