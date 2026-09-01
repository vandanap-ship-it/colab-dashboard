"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
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
function chipLabel(i: WeeklyMilestoneItem): string {
  return `V${i.villaNumber.toString().padStart(2, "0")} ${i.milestoneName}`;
}

// -------- §2 Contractor strip + Milestone Card (Python PDF template) --------
function ContractorStrip({ index, name, villaNote, pill }: {
  index: number;
  name: string;
  villaNote: string;
  pill: { text: string; tone: "active" | "muted" };
}) {
  return (
    <div className={weekly.mpContractorStrip}>
      <div className={weekly.mpContractorLeft}>
        <div className={weekly.mpContractorName}>Contractor {index} · {name}</div>
        <div className={weekly.mpContractorNote}>{villaNote}</div>
      </div>
      <span className={`${weekly.mpPill} ${pill.tone === "active" ? weekly.mpPillActive : weekly.mpPillMuted}`}>
        {pill.text}
      </span>
    </div>
  );
}

function MilestoneCard({
  title, big, denom, subLbl, emptyText, spill,
}: {
  title: string;
  big: number;
  denom: number;
  subLbl: React.ReactNode;
  emptyText: string;
  spill: { title: string; count: number; note: string; tone?: "notMoving" };
}) {
  const pct = denom > 0 ? Math.round((big / denom) * 100) : 0;
  const isEmpty = big === 0 && denom === 0;
  return (
    <div className={weekly.mpCard}>
      <div className={weekly.mpCardTitle}>{title}</div>
      <div className={weekly.mpCardBigRow}>
        <div className={weekly.mpCardBig}>{big}</div>
        <div className={weekly.mpCardDenomWrap}>
          <div className={weekly.mpCardDenom}>/ {denom}</div>
          <div className={weekly.mpCardSubLbl}>{subLbl}</div>
        </div>
      </div>
      <div className={weekly.mpCardBar}>
        <div className={weekly.mpCardBarFill} style={{ width: `${pct}%` }} />
        <span className={weekly.mpCardBarPct}>{isEmpty ? "0%" : `${pct}%`}</span>
      </div>
      <div className={weekly.mpCardNote}>{emptyText}</div>
      <hr className={weekly.mpCardHr} />
      <div className={`${weekly.mpCardSpillTitle} ${spill.tone === "notMoving" ? weekly.mpCardSpillTitleNotMoving : weekly.mpCardSpillTitleAmber}`}>
        {spill.title}
      </div>
      <div className={weekly.mpCardSpillCount}>{spill.tone === "notMoving" ? spill.count : `+${spill.count}`}</div>
      <div className={weekly.mpCardSpillNote}>{spill.note}</div>
    </div>
  );
}

// -------- §3 Milestone drill-down table (Python PDF style) --------
type MilestoneTableRow = WeeklyMilestoneItem & { tag: "SPILLED" | "THIS WEEK" | "MOVING" | "STALLED" };
function MilestoneTable({
  kind, title, rows,
}: {
  kind: "complete" | "start" | "in-progress";
  title: string;
  rows: MilestoneTableRow[];
}) {
  const dateHeader = kind === "complete" ? "PLANNED FINISH" : kind === "start" ? "PLANNED START" : "PLANNED WINDOW";
  const dateBucketHeader = kind === "complete" ? "DAYS PAST" : "DAYS IDLE";
  return (
    <div className={weekly.mbSection}>
      <div className={`${weekly.mbBanner} ${kind === "complete" ? weekly.mbBannerComplete : kind === "start" ? weekly.mbBannerStart : weekly.mbBannerInProgress}`}>{title}</div>
      {rows.length === 0 ? (
        <div className={weekly.mbEmpty}>Nothing in this bucket this week.</div>
      ) : (
        <table className={weekly.mbTable}>
          <thead>
            <tr>
              <th>VILLA</th>
              <th>BLOCK</th>
              <th>MILESTONE</th>
              <th>{dateHeader}</th>
              <th>{dateBucketHeader}</th>
              <th>WHEN</th>
              <th>ON SITE?</th>
              <th>DELAY REASON</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const daysPast = r.daysLate ?? 0;
              const dateStr = kind === "complete"
                ? "—"
                : kind === "start" && r.sinceDate
                ? new Date(r.sinceDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                : "—";
              const onSite = r.movedThisWeek ? "moved this week" : r.tag === "STALLED" ? "no progress logged" : r.daysIdle != null ? "being worked" : "not started";
              return (
                <tr key={`${r.villaNumber}-${r.milestoneName}-${i}`}>
                  <td className={weekly.mbVilla}>V{r.villaNumber.toString().padStart(2, "0")}</td>
                  <td>Block {r.blockCode}</td>
                  <td>{r.milestoneName}</td>
                  <td>{dateStr}</td>
                  <td className={daysPast > 0 ? weekly.mbLate : ""}>{daysPast > 0 ? `${daysPast}d` : "—"}</td>
                  <td>
                    <span className={`${weekly.mbTag} ${r.tag === "SPILLED" ? weekly.mbTagSpilled : r.tag === "THIS WEEK" ? weekly.mbTagWeek : r.tag === "MOVING" ? weekly.mbTagMoving : weekly.mbTagStalled}`}>
                      {r.tag}
                    </span>
                  </td>
                  <td>
                    <span className={weekly.mbSitePill}>{onSite}</span>
                  </td>
                  <td className={weekly.mbReason}>{r.reason ?? "not recorded"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function WeeklyReportView({ report, projectId, weekEndingStr }: WeeklyReportViewProps) {
  const router = useRouter();

  const onDateChange = useCallback((v: string) => {
    if (v) router.push(`/projects/${projectId}/reports/weekly?weekEnding=${v}`);
  }, [router, projectId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    const projectSlug = report.project.name.replace(/[^\w\s-]/g, "").trim();
    document.title = `${projectSlug} Weekly Report ${weekEndingStr}`;
    return () => { document.title = previous; };
  }, [weekEndingStr, report.project.name]);

  const onDownload = useCallback(() => {
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
        <button type="button" onClick={onDownload} className={styles.toolbarBtn}>
          <Download size={14} aria-hidden />
          Download PDF
        </button>
      </div>

      {/* Header — dark navy hero. Date range right-aligned per Python PDF. */}
      <div className={weekly.hero}>
        <div className={weekly.heroCrumb}>
          <span className={weekly.heroCrumbDot} />
          {(report.project.tagline ?? "White Lotus Group").toUpperCase()} · {report.project.name.toUpperCase()} {report.project.code ? `· ${report.project.code.toUpperCase()}` : ""}
        </div>
        <div className={weekly.heroBody}>
          <h1 className={weekly.heroTitle}>
            Weekly Progress <em>Report</em>
          </h1>
          <div className={weekly.heroDate}>{fmtDayShort(report.weekStart)}–{fmtDayShort(report.weekEnd)} {report.weekEnd.getFullYear()}</div>
        </div>
      </div>

      {/* §1 Overall Project Progress — Target & Actual only, panels inside a
          dark navy card (Python PDF style). */}
      <Section num="01" title="Overall Project Progress" meta={`progress required by Sun ${fmtDayShort(report.weekEnd)} vs achieved`}>
        <div className={weekly.overallHeroCard}>
          <div className={weekly.overallHeroPanel}>
            <div className={weekly.overallHeroLbl}>TARGET · DUE BY {fmtDayShort(report.weekEnd).toUpperCase()}</div>
            <div className={weekly.overallHeroVal}>{fmtPct(report.overall.plannedPct)}</div>
          </div>
          <div className={weekly.overallHeroPanel}>
            <div className={weekly.overallHeroLbl}>ACTUAL · ACHIEVED</div>
            <div className={`${weekly.overallHeroVal} ${weekly.overallHeroValGold}`}>{fmtPct(report.overall.actualPct)}</div>
          </div>
        </div>
      </Section>

      {/* §2 Weekly Milestone Plan — Python PDF template.
          One "Contractor N" strip per contractor, then 3 side-by-side cards
          (TO COMPLETE / TO START / IN PROGRESS) with big number, progress
          bar, and SPILLED-OVER / NOT-MOVING callouts. */}
      <Section num="02" title="Weekly Milestone Plan · Contractor-wise" meta="planned vs actual · this week + spill-over from earlier">
        {report.milestonePlans.map((plan, idx) => {
          const isFirst = idx === 0;
          const isElegant = plan.contractorName.trim().toLowerCase() === "elegant construction";
          const noSchedule = !plan.hasSchedule || isElegant;
          return (
            <div key={plan.contractorId ?? plan.contractorName}>
              <ContractorStrip
                index={idx + 1}
                name={plan.contractorName}
                villaNote={
                  isElegant
                    ? "52 villas · Awarded — 52 villas across 12 blocks. Schedule received; integration with the collab tools under process."
                    : `${plan.hasSchedule ? "full schedule loaded" : "schedule yet to be received"}`
                }
                pill={isElegant ? { text: "Schedule received", tone: "muted" } : { text: "Active", tone: "active" }}
              />
              {isFirst && !noSchedule && (
                <>
                  <div className={weekly.mpCards}>
                    <MilestoneCard
                      title="MILESTONES TO COMPLETE"
                      big={plan.toComplete.closed}
                      denom={plan.toComplete.total}
                      subLbl={<>CLOSED THIS WEEK<br />OF PLANNED FINISHES</>}
                      emptyText={plan.toComplete.items.length === 0 ? "planned but not closed: none" : `planned but not closed: ${plan.toComplete.items.map(chipLabel).join(", ")}`}
                      spill={{
                        title: "SPILLED OVER FROM EARLIER",
                        count: plan.overdue.total,
                        note: plan.overdue.total > 0 ? `overdue, still open: ${plan.overdue.items.map(chipLabel).join(", ")}` : "none",
                      }}
                    />
                    <MilestoneCard
                      title="MILESTONES TO START"
                      big={plan.toStart.started}
                      denom={plan.toStart.total}
                      subLbl={<>STARTED THIS WEEK<br />OF PLANNED STARTS</>}
                      emptyText={
                        plan.toStart.total === 0
                          ? "planned but not started: none"
                          : `planned but not started: ${plan.toStart.items.filter((i) => !plan.toStart.items.slice(0, plan.toStart.started).includes(i)).map(chipLabel).join(", ") || "none"}`
                      }
                      spill={{
                        title: "SPILLED OVER FROM EARLIER",
                        count: plan.toStart.spill,
                        note: plan.toStart.spill > 0 ? `should have started: ${plan.toStart.spillItems.map(chipLabel).join(", ")}` : "none",
                      }}
                    />
                    <MilestoneCard
                      title="MILESTONES IN PROGRESS"
                      big={plan.inProgress.moving}
                      denom={plan.inProgress.total}
                      subLbl={<>ACTUALLY MOVING<br />OF PLANNED IN PROGRESS</>}
                      emptyText={plan.inProgress.stalled === 0 ? "the rest are moving on site" : "the rest are moving on site"}
                      spill={{
                        title: "NOT MOVING",
                        count: plan.inProgress.stalled,
                        note: plan.inProgress.stalled > 0 ? `no progress logged this week: ${plan.inProgress.stalledItems.map(chipLabel).join(", ")}` : "none",
                        tone: "notMoving",
                      }}
                    />
                  </div>
                  <p className={weekly.mpExplain}>
                    One milestone = a villa&apos;s current construction stage. <strong>To complete</strong> and <strong>in progress</strong> overlap where a stage is due to finish this week. Spill-over = stages whose planned date has already passed and are still open or not started. Read Planned → Actual left to right in each card.
                  </p>
                </>
              )}
            </div>
          );
        })}
      </Section>

      {/* §3 Milestone Breakdown — three drill-down tables per PDF. */}
      {(() => {
        // Just the Abraham plan (Contractor 1) — Elegant is name-only.
        const p1 = report.milestonePlans.find((m) => m.contractorName.trim().toLowerCase() !== "elegant construction" && m.hasSchedule);
        if (!p1) return null;
        return (
          <Section num="03" title="Milestone breakdown" meta="the villas inside each of the three metrics above">
            <MilestoneTable
              kind="complete"
              title={`TO COMPLETE — ${p1.toComplete.total} MILESTONES DUE, ${p1.toComplete.closed} CLOSED`}
              rows={[
                ...p1.overdue.items.map((it) => ({ ...it, tag: "SPILLED" as const })),
                ...p1.toComplete.items.map((it) => ({ ...it, tag: "THIS WEEK" as const })),
              ].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))}
            />
            <MilestoneTable
              kind="start"
              title={`TO START — ${p1.toStart.total} THIS WEEK, ${p1.toStart.started} STARTED`}
              rows={[
                ...p1.toStart.spillItems.map((it) => ({ ...it, tag: "SPILLED" as const })),
                ...p1.toStart.items.map((it) => ({ ...it, tag: "THIS WEEK" as const })),
              ].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))}
            />
            <MilestoneTable
              kind="in-progress"
              title={`IN PROGRESS — ${p1.inProgress.total} MILESTONES · ${p1.inProgress.moving} MOVING · ${p1.inProgress.stalled} STALLED`}
              rows={[
                ...p1.inProgress.movingItems.map((it) => ({ ...it, tag: "MOVING" as const })),
                ...p1.inProgress.stalledItems.map((it) => ({ ...it, tag: "STALLED" as const })),
              ]}
            />
            {/* Stalled aging bar panel — RUNBOOK weekly §3 add-on. */}
            <StalledPanel items={p1.inProgress.stalledItems} />
          </Section>
        );
      })()}

      {/* §4 Manpower */}
      <Section num="04" title="Manpower" meta="planned vs actual · trade breakdown">
        {/* Site-total roll-up tile — Python parity header block. */}
        {report.manpowerSiteTotal.weeklyPlanned > 0 && (
          <div className={weekly.contractorBlock}>
            <div className={weekly.contractorTitle}>Site total · all contractors</div>
            <div className={weekly.mpHead4}>
              <div className={weekly.mpHeadCell}>
                <div className={weekly.mpHeadLbl}>Weekly target</div>
                <div className={weekly.mpHeadVal}>{report.manpowerSiteTotal.weeklyPlanned}</div>
                <div className={weekly.mpHeadSub}>
                  {report.manpowerSiteTotal.workingDays > 0
                    ? `${Math.round(report.manpowerSiteTotal.weeklyPlanned / report.manpowerSiteTotal.workingDays)}/DAY × ${report.manpowerSiteTotal.workingDays}D`
                    : "—"}
                </div>
              </div>
              <div className={weekly.mpHeadCell}>
                <div className={weekly.mpHeadLbl}>Achieved</div>
                <div className={weekly.mpHeadVal}>{report.manpowerSiteTotal.weeklyActual}</div>
                <div className={weekly.mpHeadSub}>{report.manpowerSiteTotal.loggedDays}/{report.manpowerSiteTotal.workingDays} DAYS LOGGED</div>
              </div>
              <div className={weekly.mpHeadCell}>
                <div className={weekly.mpHeadLbl}>Week vs target</div>
                <div className={weekly.mpHeadVal}>
                  {report.manpowerSiteTotal.pctOfPlan == null ? "—" : `${report.manpowerSiteTotal.pctOfPlan}%`}
                </div>
                <div className={weekly.mpHeadSub}>
                  {report.manpowerSiteTotal.workingDays > 0
                    ? `AVG ${Math.round(report.manpowerSiteTotal.weeklyActual / report.manpowerSiteTotal.workingDays)}/DAY ACTUAL`
                    : "—"}
                </div>
              </div>
              <div className={weekly.mpHeadCell}>
                <div className={weekly.mpHeadLbl}>Best day</div>
                <div className={weekly.mpHeadVal}>{report.manpowerSiteTotal.bestDayActual}</div>
                <div className={weekly.mpHeadSub}>
                  {report.manpowerSiteTotal.bestDayDate
                    ? new Date(report.manpowerSiteTotal.bestDayDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
        {report.manpowerByContractor.map((c) => (
          <div key={c.contractorId} className={weekly.contractorBlock}>
            <div className={weekly.contractorTitle}>Contractor · {c.contractorName}</div>
            {!c.hasPlan ? (
              <div className={styles.empty}>No manpower plan set.</div>
            ) : (
              <>
                {/* 4-tile weekly strip per RUNBOOK §4 (no Remark box). */}
                {(() => {
                  const workingDays = c.perDay.filter((d) => !d.isHoliday).length;
                  const loggedDays = c.perDay.filter((d) => d.actualTotal > 0).length;
                  const planPerDay = workingDays > 0 ? Math.round(c.weeklyPlanned / workingDays) : 0;
                  // Python parity (build_wk23.py L190): avg = actual / 7 (per week
                  // day, incl. holidays if any) — the "how many workers actually
                  // showed up on an average day". Not planned/day.
                  const avgActualPerDay = c.perDay.length > 0
                    ? Math.round(c.weeklyActual / c.perDay.length)
                    : 0;
                  return (
                    <div className={weekly.mpHead4}>
                      <div className={weekly.mpHeadCell}>
                        <div className={weekly.mpHeadLbl}>Weekly target</div>
                        <div className={weekly.mpHeadVal}>{c.weeklyPlanned}</div>
                        <div className={weekly.mpHeadSub}>{planPerDay}/DAY × {workingDays}D</div>
                      </div>
                      <div className={weekly.mpHeadCell}>
                        <div className={weekly.mpHeadLbl}>Achieved</div>
                        <div className={weekly.mpHeadVal}>{c.weeklyActual}</div>
                        <div className={weekly.mpHeadSub}>{loggedDays}/{workingDays} DAYS LOGGED</div>
                      </div>
                      <div className={weekly.mpHeadCell}>
                        <div className={weekly.mpHeadLbl}>Week vs target</div>
                        <div className={weekly.mpHeadVal}>{c.pctOfPlan == null ? "—" : `${c.pctOfPlan}%`}</div>
                        <div className={weekly.mpHeadSub}>AVG {avgActualPerDay}/DAY ACTUAL</div>
                      </div>
                      <div className={weekly.mpHeadCell}>
                        <div className={weekly.mpHeadLbl}>Best day</div>
                        <div className={weekly.mpHeadVal}>{c.bestDayActual}</div>
                        <div className={weekly.mpHeadSub}>
                          {c.bestDayDate
                            ? `${new Date(c.bestDayDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()} · VS ${avgActualPerDay}`
                            : "—"}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <ManpowerChart perDay={c.perDay} />
                <ManpowerTradeTable perDay={c.perDay} />
              </>
            )}
          </div>
        ))}
      </Section>

      {/* §5 Delay Reasons & Mitigation */}
      <Section num="05" title="Delay Reasons & Mitigation" meta="ranked by activity count · avg days late across the reason bucket">
        {report.delayReasons.length === 0 ? (
          <div className={styles.empty}>No open hindrances tagged this week. Excellent.</div>
        ) : (
          <div className={weekly.reasonList}>
            {report.delayReasons.map((r) => (
              <div key={r.code} className={weekly.reasonCard}>
                <div className={weekly.reasonHead}>
                  <div className={weekly.reasonName}>{r.label}</div>
                  <div className={weekly.reasonStat}>
                    {r.avgDaysImpact > 0 && (
                      <span className={weekly.reasonDays}>avg {r.avgDaysImpact}d</span>
                    )}
                    {r.maxDaysImpact > 0 && (
                      <span className={weekly.reasonDays}>worst {r.maxDaysImpact}d</span>
                    )}
                    <span className={weekly.reasonCount}>{r.activityCount} act{r.activityCount === 1 ? "" : "s"}</span>
                    <span className={weekly.reasonVillas}>
                      {r.affectedVillas.length} villa{r.affectedVillas.length === 1 ? "" : "s"}
                      {r.hasProjectLevel && " · +project-level"}
                    </span>
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
  variant?: "in-progress" | "overdue";
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
              <span className={weekly.bucketItemVilla}>{it.villaLabel ?? `V${it.villaNumber}`}</span>
              <span className={weekly.bucketItemMilestone}>{it.milestoneName}</span>
              {it.daysLate != null && it.daysLate > 0 && <span className={weekly.bucketItemLate}>+{it.daysLate}d late</span>}
              {variant === "in-progress" && it.movedThisWeek === false && it.daysIdle != null && (
                <span className={weekly.bucketItemStalled}>idle {it.daysIdle}d</span>
              )}
              {variant === "in-progress" && it.movedThisWeek === true && (
                <span className={weekly.bucketItemMoving}>moved this week</span>
              )}
              {it.reason && <span className={weekly.bucketItemReason}>reason: {it.reason}</span>}
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
          {d.isHoliday ? (
            <div className={weekly.chartHoliday}>
              <span className={weekly.chartHolidayLabel}>HOLIDAY</span>
              {d.actualTotal > 0 && (
                <span className={weekly.chartHolidayActual}>+{d.actualTotal}</span>
              )}
            </div>
          ) : (
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
          )}
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
            <th
              key={d.date.toISOString()}
              className={`${weekly.tradeTblRight} ${d.isHoliday ? weekly.tradeTblHolCell : ""}`}
            >
              {fmtDayShort(d.date)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => (
          <tr key={trade}>
            <td>{trade}</td>
            {perDay.map((d) => {
              const cell = d.trades.find((t) => t.trade === trade);
              if (d.isHoliday) {
                return (
                  <td key={d.date.toISOString()} className={`${weekly.tradeTblRight} ${weekly.tradeTblHolCell}`}>
                    Hol
                  </td>
                );
              }
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

/**
 * Stalled — needs a push aging-bar panel. Per RUNBOOK weekly §3, this
 * lives at the bottom of the In-Progress bucket. For each stalled villa
 * we render a horizontal bar sized by days_idle vs the worst-idled item
 * this week, coloured red (≥14d), amber (≥7d), or gold (<7d). Empty
 * state: "Nothing stalled — every planned milestone is moving on site."
 */
function StalledPanel({ items }: { items: WeeklyMilestoneItem[] }) {
  const stalled = items.filter((it) => it.movedThisWeek === false && it.daysIdle != null);
  const maxIdle = Math.max(1, ...stalled.map((it) => it.daysIdle ?? 0));
  return (
    <div className={weekly.stalledPanel}>
      <div className={weekly.stalledHd}>
        <div className={weekly.stalledTitle}>Stalled · needs a push</div>
        <div className={weekly.stalledCaption}>
          Planned to be under way but zero progress this week. Bar = days idle.
        </div>
      </div>
      {stalled.length === 0 ? (
        <div className={weekly.stalledEmpty}>
          Nothing stalled — every planned milestone is moving on site.
        </div>
      ) : (
        <ul className={weekly.stalledList}>
          {stalled.slice(0, 12).map((it, i) => {
            const idle = it.daysIdle ?? 0;
            const widthPct = Math.max(4, Math.round((idle / maxIdle) * 100));
            const tone = idle >= 14 ? weekly.stalledBarRed : idle >= 7 ? weekly.stalledBarAmber : weekly.stalledBarGold;
            const sinceStr = it.sinceDate
              ? new Date(it.sinceDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
              : null;
            return (
              <li key={i} className={weekly.stalledRow}>
                <div className={weekly.stalledLbl}>
                  <span className={weekly.stalledVilla}>{it.villaLabel ?? `V${it.villaNumber}`}</span>
                  <span className={weekly.stalledMs}>{it.milestoneName}</span>
                  <span className={weekly.stalledBlock}>· Block {it.blockCode}</span>
                </div>
                <div className={weekly.stalledBarWrap}>
                  <div className={`${weekly.stalledBar} ${tone}`} style={{ width: `${widthPct}%` }} />
                </div>
                <div className={weekly.stalledIdle}>{idle}d idle</div>
                <div className={weekly.stalledReason}>
                  {it.reason ?? "no cause logged"}
                  {sinceStr && <span className={weekly.stalledSince}> · since {sinceStr}</span>}
                </div>
              </li>
            );
          })}
          {stalled.length > 12 && (
            <li className={weekly.stalledMore}>+{stalled.length - 12} more stalled</li>
          )}
        </ul>
      )}
    </div>
  );
}
