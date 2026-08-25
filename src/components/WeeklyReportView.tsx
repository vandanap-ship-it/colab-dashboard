"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import styles from "./scorecard.module.css";
import weekly from "./weekly-report.module.css";
import type { WeeklyReport, WeeklyMilestoneItem } from "@/lib/weeklyReportServer";

export interface WeeklyReportViewProps {
  report: WeeklyReport;
  projectId: string;
  weekEndingStr: string; // YYYY-MM-DD
}

function fmtLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtPct(n: number): string { return `${n.toFixed(2)}%`; }

export default function WeeklyReportView({ report, projectId, weekEndingStr }: WeeklyReportViewProps) {
  const router = useRouter();

  const onDateChange = useCallback((v: string) => {
    if (v) router.push(`/projects/${projectId}/reports/weekly?weekEnding=${v}`);
  }, [router, projectId]);
  const onPrint = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  const asOfLabel = `${fmtLong(report.weekStart)} → ${fmtLong(report.weekEnd)}`;

  return (
    <div className={styles.wrap}>
      {/* Toolbar (screen only) */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarLbl}>Week ending</span>
          <input
            type="date"
            value={weekEndingStr}
            onChange={(e) => onDateChange(e.target.value)}
            className={styles.toolbarDate}
          />
        </div>
        <button type="button" onClick={onPrint} className={styles.toolbarBtn}>
          <Printer size={14} aria-hidden />
          Download / Print
        </button>
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerCrumb}>
          {report.project.tagline ?? "White Lotus Group"} · {report.project.name} {report.project.code ? `· ${report.project.code}` : ""}
        </div>
        <h1 className={styles.headerTitle}>
          Weekly Progress <em>Report</em>
        </h1>
        <div className={styles.headerDate}>{asOfLabel}</div>
        <div className={styles.headerTagline}>week ending {fmtLong(report.weekEnd)}</div>
      </div>

      {/* §1 Overall Progress */}
      <Section num="01" title="Overall Progress" meta={`planned vs actual at ${fmtLong(report.weekEnd)}`}>
        <div className={weekly.overallRow}>
          <div className={`${weekly.overallCell} ${weekly.overallPlanned}`}>
            <div className={weekly.overallLbl}>Planned</div>
            <div className={weekly.overallVal}>{fmtPct(report.overall.plannedPct)}</div>
          </div>
          <div className={`${weekly.overallCell} ${weekly.overallActual}`}>
            <div className={weekly.overallLbl}>Actual</div>
            <div className={weekly.overallVal}>{fmtPct(report.overall.actualPct)}</div>
          </div>
          <div className={`${weekly.overallCell} ${report.overall.variancePct >= 0 ? weekly.overallVarGood : weekly.overallVarBad}`}>
            <div className={weekly.overallLbl}>Variance</div>
            <div className={weekly.overallVal}>
              {report.overall.variancePct >= 0 ? "+" : ""}{fmtPct(report.overall.variancePct)}
            </div>
          </div>
        </div>
      </Section>

      {/* §2 Milestone Plan */}
      <Section num="02" title="Milestone Plan" meta="per contractor · to complete / to start / in progress / stalled">
        {report.milestonePlans.map((plan) => (
          <div key={plan.contractorId ?? plan.contractorName} className={weekly.contractorBlock}>
            <div className={weekly.contractorTitle}>
              Contractor · {plan.contractorName}
              {!plan.hasSchedule && <span className={weekly.contractorNoSched}> · schedule yet to be received</span>}
            </div>
            {plan.hasSchedule ? (
              <>
                <MilestoneBucket
                  label="Milestones to complete"
                  metric={`${plan.toComplete.closed} / ${plan.toComplete.total}`}
                  metricLbl="closed of planned"
                  items={plan.toComplete.items}
                />
                <MilestoneBucket
                  label="Milestones to start"
                  metric={`${plan.toStart.started} / ${plan.toStart.total}`}
                  metricLbl="started of planned"
                  items={plan.toStart.items}
                />
                <MilestoneBucket
                  label="In progress"
                  metric={`${plan.inProgress.moving} moving · ${plan.inProgress.stalled} stalled`}
                  metricLbl=""
                  items={[...plan.inProgress.movingItems, ...plan.inProgress.stalledItems]}
                  variant="in-progress"
                />
              </>
            ) : (
              <div className={styles.empty}>No schedule loaded in the tracker.</div>
            )}
          </div>
        ))}
      </Section>

      {/* §3 Manpower */}
      <Section num="03" title="Manpower" meta="planned vs actual · trade breakdown">
        {report.manpowerByContractor.map((c) => (
          <div key={c.contractorId} className={weekly.contractorBlock}>
            <div className={weekly.contractorTitle}>Contractor · {c.contractorName}</div>
            {!c.hasPlan ? (
              <div className={styles.empty}>No manpower plan set.</div>
            ) : (
              <>
                <div className={weekly.mpHead}>
                  <div className={weekly.mpHeadCell}>
                    <div className={weekly.mpHeadLbl}>Weekly total</div>
                    <div className={weekly.mpHeadVal}>{c.weeklyActual} / {c.weeklyPlanned}</div>
                  </div>
                  <div className={weekly.mpHeadCell}>
                    <div className={weekly.mpHeadLbl}>Week vs plan</div>
                    <div className={weekly.mpHeadVal}>{c.pctOfPlan == null ? "—" : `${c.pctOfPlan}%`}</div>
                  </div>
                  <div className={weekly.mpHeadCell}>
                    <div className={weekly.mpHeadLbl}>Best day</div>
                    <div className={weekly.mpHeadVal}>{c.bestDayActual}</div>
                  </div>
                </div>
                <ManpowerChart perDay={c.perDay} />
                <ManpowerTradeTable perDay={c.perDay} />
              </>
            )}
          </div>
        ))}
      </Section>

      {/* §4 Delay Reasons & Mitigation */}
      <Section num="04" title="Delay Reasons & Mitigation" meta="ranked by days impact this week">
        {report.delayReasons.length === 0 ? (
          <div className={styles.empty}>No open hindrances tagged this week. Excellent.</div>
        ) : (
          <div className={weekly.reasonList}>
            {report.delayReasons.map((r) => (
              <div key={r.code} className={weekly.reasonCard}>
                <div className={weekly.reasonHead}>
                  <div className={weekly.reasonName}>{r.label}</div>
                  <div className={weekly.reasonStat}>
                    {r.daysImpact > 0 && <span className={weekly.reasonDays}>+{r.daysImpact}d</span>}
                    <span className={weekly.reasonCount}>{r.count} record{r.count === 1 ? "" : "s"}</span>
                    <span className={weekly.reasonVillas}>{r.affectedVillas.length} villa{r.affectedVillas.length === 1 ? "" : "s"}</span>
                  </div>
                </div>
                {r.affectedVillas.length > 0 && (
                  <div className={weekly.reasonVillasList}>
                    {r.affectedVillas.slice(0, 20).map((n) => (
                      <span key={n} className={weekly.reasonVillaChip}>V{n}</span>
                    ))}
                    {r.affectedVillas.length > 20 && <span className={weekly.reasonMoreChip}>+{r.affectedVillas.length - 20}</span>}
                  </div>
                )}
                <div className={weekly.reasonMitigation}>
                  <span className={weekly.reasonMitigationLbl}>Mitigation</span>
                  {r.mitigation}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bucket + Chart + Trade table
// ---------------------------------------------------------------------------

function MilestoneBucket({
  label,
  metric,
  metricLbl,
  items,
  variant,
}: {
  label: string;
  metric: string;
  metricLbl: string;
  items: WeeklyMilestoneItem[];
  variant?: "in-progress";
}) {
  return (
    <div className={weekly.bucket}>
      <div className={weekly.bucketHd}>
        <div className={weekly.bucketLbl}>{label}</div>
        <div className={weekly.bucketMetric}>
          {metric}{metricLbl && <span className={weekly.bucketMetricLbl}> {metricLbl}</span>}
        </div>
      </div>
      {items.length === 0 ? (
        <div className={weekly.bucketEmpty}>—</div>
      ) : (
        <div className={weekly.bucketItems}>
          {items.slice(0, 12).map((it, i) => (
            <div key={`${it.villaNumber}-${it.milestoneName}-${i}`} className={weekly.bucketItem}>
              <span className={weekly.bucketItemVilla}>V{it.villaNumber}</span>
              <span className={weekly.bucketItemMilestone}>{it.milestoneName}</span>
              {it.daysLate != null && it.daysLate > 0 && <span className={weekly.bucketItemLate}>+{it.daysLate}d</span>}
              {variant === "in-progress" && it.movedThisWeek === false && it.daysIdle && (
                <span className={weekly.bucketItemStalled}>idle {it.daysIdle}d</span>
              )}
            </div>
          ))}
          {items.length > 12 && (
            <div className={weekly.bucketItemMore}>+{items.length - 12} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function ManpowerChart({ perDay }: { perDay: WeeklyReport["manpowerByContractor"][number]["perDay"] }) {
  const max = Math.max(1, ...perDay.map((d) => Math.max(d.plannedTotal, d.actualTotal)));
  return (
    <div className={weekly.chart}>
      {perDay.map((d) => (
        <div key={d.date.toISOString()} className={weekly.chartCell}>
          <div className={weekly.chartBars}>
            <div
              className={`${weekly.chartBar} ${weekly.chartBarPlanned}`}
              style={{ height: `${(d.plannedTotal / max) * 100}%` }}
              title={`Planned: ${d.plannedTotal}`}
            >
              {d.plannedTotal > 0 && <span className={weekly.chartValue}>{d.plannedTotal}</span>}
            </div>
            <div
              className={`${weekly.chartBar} ${weekly.chartBarActual}`}
              style={{ height: `${(d.actualTotal / max) * 100}%` }}
              title={`Actual: ${d.actualTotal}`}
            >
              {d.actualTotal > 0 && <span className={weekly.chartValue}>{d.actualTotal}</span>}
            </div>
          </div>
          <div className={weekly.chartDay}>{fmtDayShort(d.date)}</div>
        </div>
      ))}
    </div>
  );
}

function ManpowerTradeTable({ perDay }: { perDay: WeeklyReport["manpowerByContractor"][number]["perDay"] }) {
  // Reshape into trade × day matrix using all trades that appeared anywhere in the week.
  const trades = Array.from(new Set(perDay.flatMap((d) => d.trades.map((t) => t.trade))));
  if (trades.length === 0) return null;

  return (
    <table className={weekly.tradeTbl}>
      <thead>
        <tr>
          <th>Trade</th>
          {perDay.map((d) => (
            <th key={d.date.toISOString()} className={weekly.tradeTblRight}>{fmtDayShort(d.date)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <tr key={trade}>
            <td>{trade}</td>
            {perDay.map((d) => {
              const cell = d.trades.find((t) => t.trade === trade);
              return (
                <td key={d.date.toISOString()} className={weekly.tradeTblRight}>
                  {cell ? `${cell.actual}/${cell.planned}` : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({
  num,
  title,
  meta,
  children,
}: {
  num: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHd}>
        <span className={styles.sectionNum}>{num}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {meta && <div className={styles.sectionMeta}>{meta}</div>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
