"use client";

import { useMemo, useState } from "react";
import styles from "./executive.module.css";
import type { ManpowerDay } from "./ExecutiveOverview";

export interface ManpowerChartCardProps {
  range: ManpowerDay[];
}

/**
 * Daily site-headcount bar chart with a 7-day / 30-day toggle.
 *
 * Added 2026-11-04 (Vandana management review) to replace the single
 * "Daily Manpower" tile. Management wants a trend, not just today's
 * number - a chart explains "below plan on three days, above on four"
 * at a glance where a single number can't.
 *
 * Shows planned-vs-actual bars per day. A day with zero plan (common on
 * Amanvana today) just renders the actual bar in neutral colour. A day
 * with a plan but zero actual renders the plan ghost + an "x" to flag
 * missing logging.
 */
export default function ManpowerChartCard({ range }: ManpowerChartCardProps) {
  const [window, setWindow] = useState<"7d" | "30d">("7d");
  const data = useMemo(() => (window === "7d" ? range.slice(-7) : range), [range, window]);
  const max = Math.max(1, ...data.flatMap((d) => [d.planned, d.actual]));
  const totalActual = data.reduce((s, d) => s + d.actual, 0);
  const totalPlanned = data.reduce((s, d) => s + d.planned, 0);
  const avgActual = data.length ? Math.round(totalActual / data.length) : 0;
  const hasAnyPlan = totalPlanned > 0;

  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Daily Manpower</h3>
        <div className={styles.manpowerCtrls}>
          <span className={styles.meta}>
            avg {avgActual} workers/day across the last {data.length} days
            {hasAnyPlan ? ` · plan total ${totalPlanned}` : " · no plan set for this window"}
          </span>
          <div className={styles.manpowerToggle}>
            <button
              type="button"
              className={`${styles.manpowerToggleBtn} ${window === "7d" ? styles.manpowerToggleOn : ""}`}
              onClick={() => setWindow("7d")}
            >
              Last 7 days
            </button>
            <button
              type="button"
              className={`${styles.manpowerToggleBtn} ${window === "30d" ? styles.manpowerToggleOn : ""}`}
              onClick={() => setWindow("30d")}
            >
              Last 30 days
            </button>
          </div>
        </div>
      </div>
      <div className={styles.cardBd}>
        {data.length === 0 ? (
          <div className={styles.drEmpty}>No manpower logged in this window.</div>
        ) : (
          <div className={styles.manpowerChart}>
            {data.map((d) => {
              const actualH = max > 0 ? (d.actual / max) * 100 : 0;
              const plannedH = max > 0 ? (d.planned / max) * 100 : 0;
              const planGap = d.planned > 0 && d.actual === 0;
              return (
                <div
                  key={d.date}
                  className={styles.manpowerBarCell}
                  title={`${fmtShort(d.date)} · actual ${d.actual}${d.planned > 0 ? ` / plan ${d.planned}` : ""}`}
                >
                  <div className={styles.manpowerBarValue}>
                    {d.actual > 0 ? d.actual.toLocaleString("en-IN") : ""}
                  </div>
                  <div className={styles.manpowerBarStack}>
                    {d.planned > 0 && (
                      <div className={styles.manpowerPlanBar} style={{ height: `${plannedH}%` }} />
                    )}
                    <div
                      className={`${styles.manpowerActualBar} ${planGap ? styles.manpowerActualBarWarn : ""}`}
                      style={{ height: `${actualH}%` }}
                    />
                  </div>
                  <div className={styles.manpowerDayLbl}>{fmtDay(d.date)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit" });
}
function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
