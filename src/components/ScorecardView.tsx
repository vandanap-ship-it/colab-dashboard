"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import styles from "./scorecard.module.css";
import type { Scorecard } from "@/lib/scorecardServer";

export interface ScorecardViewProps {
  scorecard: Scorecard;
  projectId: string;
  dateStr: string; // "YYYY-MM-DD" — drives the date picker
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtLong(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtShort(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtDays(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString()} d`;
}
function fmtDaysSigned(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "0 d";
  return n > 0 ? `+${n} d` : `${n} d`;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScorecardView({ scorecard: s, projectId, dateStr }: ScorecardViewProps) {
  const router = useRouter();

  const onDateChange = useCallback((v: string) => {
    if (v) router.push(`/projects/${projectId}/reports/scorecard?date=${v}`);
  }, [router, projectId]);

  // Set document.title so the browser's Print → Save-as-PDF flow proposes a
  // meaningful default filename (e.g. "Amanvana Daily Scorecard 2026-08-27.pdf")
  // instead of the ugly URL slug. Restore on unmount so the tab title isn't
  // stuck if the user navigates away without printing.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    const projectSlug = s.project.name.replace(/[^\w\s-]/g, "").trim();
    document.title = `${projectSlug} Daily Scorecard ${dateStr}`;
    return () => { document.title = previous; };
  }, [dateStr, s.project.name]);

  const onDownload = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  const asOfLabel = fmtLong(s.asOf);

  return (
    <div className={styles.wrap}>
      {/* Toolbar (screen only) */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarLbl}>Report date</span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => onDateChange(e.target.value)}
            className={styles.toolbarDate}
          />
        </div>
        <button type="button" onClick={onDownload} className={styles.toolbarBtn}>
          <Download size={14} aria-hidden />
          Download PDF
        </button>
      </div>

      {/* Header (dark card) */}
      <div className={styles.header}>
        <div className={styles.headerCrumb}>
          {s.project.tagline ?? "White Lotus Group"} · {s.project.name} {s.project.code ? `· ${s.project.code}` : ""}
        </div>
        <h1 className={styles.headerTitle}>
          Site Progress <em>Scorecard</em>
        </h1>
        <div className={styles.headerDate}>{asOfLabel}</div>
        <div className={styles.headerTagline}>Daily analytics report</div>
      </div>

      {/* §1 Daily Site Snapshot — matches Colab reference: 4 tiles */}
      <Section num="01" title="Daily Site Snapshot" meta={`reporting coverage · ${asOfLabel}`}>
        <div className={styles.snap}>
          <div className={styles.snapCell}>
            <div className={styles.snapKey}>Site progress updated</div>
            <div className={styles.snapValue}>{s.dailySnapshot.progressUpdatedToday ? "Yes" : "No"}</div>
          </div>
          <div className={styles.snapCell}>
            <div className={styles.snapKey}>Contractors updated</div>
            <div className={styles.snapValue}>
              {s.dailySnapshot.contractorsUpdated}
              <span className={styles.of}>/ {s.dailySnapshot.contractorsExpected}</span>
            </div>
          </div>
          <div className={styles.snapCell}>
            <div className={styles.snapKey}>Blocks updated</div>
            <div className={styles.snapValue}>
              {s.dailySnapshot.blocksUpdated}
              <span className={styles.of}>/ {s.dailySnapshot.blocksExpected}</span>
            </div>
          </div>
          <div className={styles.snapCell}>
            <div className={styles.snapKey}>Villas updated</div>
            <div className={styles.snapValue}>
              {s.dailySnapshot.villasUpdated}
              <span className={styles.of}>/ {s.dailySnapshot.villasExpected}</span>
            </div>
          </div>
        </div>
        <div className={styles.snapFoot}>
          Measured against what was planned for {asOfLabel}: each “updated”
          count is out of the villas / blocks / contractors that had work
          expected today.
        </div>
      </Section>

      {/* §2 Daily Movement — Contractor-wise Progress + Planned Coverage (sub-panel) */}
      <Section num="02" title="Daily Movement — Contractor-wise Progress" meta={`progressed vs planned for ${asOfLabel}`}>
        <div className={styles.movementHeadline}>
          <strong>{s.dailySnapshot.villasUpdated} / {s.dailySnapshot.villasExpected}</strong> villas executed vs planned
          <span className={styles.of}> · </span>
          <strong>{s.dailySnapshot.blocksUpdated} / {s.dailySnapshot.blocksExpected}</strong> blocks
        </div>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>Contractor</th>
              <th className={styles.tblRight}>Villas in scope</th>
              <th className={styles.tblRight}>Executed / planned</th>
              <th className={styles.tblRight}>Not updated</th>
            </tr>
          </thead>
          <tbody>
            {s.movement.map((row, i) => (
              <tr key={row.contractorId ?? "__untagged__"}>
                <td>
                  <div className={styles.tblName}>
                    {row.contractorId !== null && `${String.fromCharCode(65 + i)} · `}
                    {row.contractorName}
                  </div>
                  {!row.hasSchedule && (
                    <div className={styles.tblSub}>schedule yet to be received</div>
                  )}
                  {row.contractorId === null && (
                    <div className={styles.tblSub}>activities without a contractor tag</div>
                  )}
                </td>
                <td className={styles.tblRight}>{row.scopeVillas || "—"}</td>
                <td className={styles.tblRight}>
                  {row.hasSchedule ? `${row.executed} / ${row.planned}` : "0 / —"}
                </td>
                <td className={styles.tblRight}>{row.hasSchedule ? row.notUpdated : "—"}</td>
              </tr>
            ))}
            {s.movement.length === 0 && (
              <tr><td colSpan={4} className={styles.empty}>No contractors on this project yet.</td></tr>
            )}
          </tbody>
        </table>
        <p className={styles.sectionExplain}>
          Planned for the day = villas whose work was scheduled for {asOfLabel}. Progressed = of those, how many logged an update. &quot;Untagged&quot; activities are ones without an assigned contractor yet — bulk-assign them via Admin → Contractor Assign.
        </p>

        {/* Coverage sub-panel — inline per Colab reference format */}
        <div className={styles.subPanel}>
          <div className={styles.subPanelHd}>
            <span className={styles.subPanelTitle}>Planned coverage by block</span>
            {(() => {
              const pending = s.blockCoverage.reduce((n, b) => n + (b.totalCount - b.updatedCount), 0);
              return pending > 0 ? <span className={styles.subPanelBadge}>{pending} VILLAS PENDING</span> : null;
            })()}
          </div>
          {s.blockCoverage.length === 0 ? (
            <div className={styles.empty}>No planned coverage for this day.</div>
          ) : (
            <>
              {(() => {
                const totalAhead = s.blockCoverage.reduce((n, b) => n + b.aheadCount, 0);
                return (
                  <p className={styles.sectionExplain}>
                    Coverage of the {s.blockCoverage.length} block{s.blockCoverage.length === 1 ? "" : "s"} with work planned for {asOfLabel}. Green chips are villas that logged progress; plain chips are still pending.
                    {totalAhead > 0 && (
                      <> Gold-edged chips are the {totalAhead} villa{totalAhead === 1 ? "" : "s"} that progressed ahead of plan (not scheduled for the day).</>
                    )}
                  </p>
                );
              })()}
              {s.blockCoverage.map((b) => (
                <div key={b.blockCode} className={styles.blockCoverageRow}>
                  <div className={styles.bcLabel}>
                    <div className={styles.bcName}>Block {b.blockCode}</div>
                    <div
                      className={`${styles.bcStatus} ${
                        b.status === "all-updated"
                          ? styles.bcStatusAll
                          : b.status === "partially"
                          ? styles.bcStatusPartial
                          : styles.bcStatusNone
                      }`}
                    >
                      {b.status === "all-updated"
                        ? "Updated completely"
                        : b.status === "partially"
                        ? (() => {
                            // Ahead-of-plan villas count in the numerator per Colab's convention.
                            const done = b.updatedCount + b.aheadCount;
                            return `${done} of ${b.totalCount} updated`;
                          })()
                        : "None updated"}
                    </div>
                  </div>
                  <div className={styles.bcVillas}>
                    {b.villas.map((v) => (
                      <span
                        key={`${v.villaNumber}-${v.villaLabel}-${v.aheadOfPlan ? "a" : "p"}`}
                        className={`${styles.bcChip} ${
                          v.aheadOfPlan
                            ? styles.bcChipAhead
                            : v.updated
                            ? styles.bcChipUpdated
                            : styles.bcChipNotUpdated
                        }`}
                      >
                        {v.villaLabel.replace(/^Villa\s+/i, "V")}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </Section>

      {/* §3 Daily Manpower */}
      <Section num="03" title="Daily Manpower" meta={`present vs planned · ${asOfLabel}${s.manpower.isHoliday ? " · HOLIDAY" : ""}`}>
        {s.manpower.isHoliday && (
          <div className={styles.holidayBanner}>
            <strong>HOLIDAY</strong> — {asOfLabel} is a scheduled holiday. Planned headcount is zero; any workers present are extra coverage.
          </div>
        )}
        {s.manpower.trades.length === 0 && s.manpower.plannedTotal === 0 && s.manpower.actualTotal === 0 ? (
          <div className={styles.empty}>
            No planned or actual manpower recorded for {asOfLabel}.
          </div>
        ) : (
          <>
            <div className={styles.mpHeadline}>
              <div className={styles.mpBigNum}>
                {s.manpower.actualTotal}
                <span className={styles.of}>/ {s.manpower.plannedTotal}</span>
              </div>
              <span
                className={`${styles.mpVariance} ${
                  s.manpower.variance > 0
                    ? styles.mpVarGood
                    : s.manpower.variance < 0
                    ? styles.mpVarBad
                    : styles.mpVarZero
                }`}
              >
                {s.manpower.variance > 0
                  ? `+${s.manpower.variance} above plan`
                  : s.manpower.variance === 0
                  ? "On plan"
                  : `${s.manpower.variance} below plan`}
                {s.manpower.pctOfPlan != null && ` · ${s.manpower.pctOfPlan}% of plan`}
              </span>
            </div>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Trade</th>
                  <th className={styles.tblRight}>Planned</th>
                  <th className={styles.tblRight}>Present</th>
                  <th className={styles.tblRight}>% of plan</th>
                  <th className={styles.tblRight}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {s.manpower.trades.map((t) => (
                  <tr key={`${t.contractorId}::${t.trade}`}>
                    <td className={styles.tblName}>{t.contractorName ?? "—"}</td>
                    <td>{t.trade}</td>
                    <td className={styles.tblRight}>{t.planned || "—"}</td>
                    <td className={styles.tblRight}>{t.actual || "—"}</td>
                    <td className={styles.tblRight}>{t.pctOfPlan == null ? "—" : `${t.pctOfPlan}%`}</td>
                    <td className={styles.tblRight}>
                      {t.variance > 0 ? `+${t.variance}` : t.variance === 0 ? "on plan" : t.variance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.sectionExplain}>
              Present vs planned headcount for {asOfLabel}, with % of plan per trade.
              {s.manpower.variance > 0 && ` ${s.manpower.variance} above plan.`}
              {s.manpower.variance < 0 && ` ${Math.abs(s.manpower.variance)} below plan.`}
              {s.manpower.variance === 0 && ` On plan.`}
            </p>
          </>
        )}
      </Section>

      {/* §4 Site Activity Highlights */}
      <Section
        num="04"
        title="Site Activity Highlights"
        meta={`activities logged on ${asOfLabel} · grouped block then villa`}
      >
        {s.activityHighlights.length === 0 ? (
          <div className={styles.empty}>Nothing logged today.</div>
        ) : (
          s.activityHighlights.map((g) => (
            <div key={g.blockCode} className={styles.actGroup}>
              <div className={styles.actBlockHd}>
                Block {g.blockCode} · {g.villas.reduce((n, v) => n + v.activities.length, 0)} activities
              </div>
              {g.villas.map((v) => (
                <div key={v.villaNumber}>
                  <div className={styles.actVillaHd}>
                    <span>{v.villaLabel}</span>
                    <span style={{ fontSize: 10.5, color: "#8B93A0", fontWeight: 500 }}>
                      {v.activities.length} {v.activities.length === 1 ? "activity" : "activities"}
                    </span>
                  </div>
                  {v.activities.map((a) => (
                    <div key={a.progressEntryId} className={styles.actCard}>
                      {a.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.photoUrl} alt="" className={styles.actPhoto} />
                      ) : (
                        <div className={styles.actPhotoStub}>📷 Photo not uploaded</div>
                      )}
                      <div className={styles.actInfo}>
                        {/* Title: "MilestoneSection · Activity" — matches Colab's 3-part format
                            (as close as we can get; Colab's raw Sub_Location/Head/Name aren't stored). */}
                        <div className={styles.actName}>
                          {a.milestoneName} · {a.activityName}
                        </div>
                        {/* Cumulative status */}
                        <div className={styles.actMeta}>
                          {a.achievedPct != null && (
                            <span className={styles.actPct}>{Math.round(a.achievedPct)}% complete</span>
                          )}
                          <span className={styles.actStatus}>
                            {a.achievedPct != null && a.achievedPct >= 100 ? "· done" : "· in progress"}
                          </span>
                        </div>
                        {/* Daily delta */}
                        {a.dailyDeltaPct != null && a.dailyDeltaPct > 0 && (
                          <div className={styles.actDelta}>
                            +{a.dailyDeltaPct}% completed on {new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </div>
                        )}
                        {/* Planned end + overdue/ahead */}
                        {a.plannedEndDate && (
                          <div className={styles.actPlanned}>
                            Planned end {new Date(a.plannedEndDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            {a.daysToPlannedEnd != null && a.daysToPlannedEnd < 0 && (
                              <span className={styles.actOverdue}> · {Math.abs(a.daysToPlannedEnd)} days overdue</span>
                            )}
                            {a.daysToPlannedEnd != null && a.daysToPlannedEnd > 0 && (
                              <span className={styles.actAhead}> · {a.daysToPlannedEnd} days to planned end</span>
                            )}
                            {a.daysToPlannedEnd === 0 && (
                              <span className={styles.actOverdue}> · due today</span>
                            )}
                          </div>
                        )}
                        {/* REMARK block (labeled per Colab format) */}
                        {a.notes && (
                          <div className={styles.actBlock}>
                            <div className={styles.actBlockLbl}>REMARK</div>
                            <div className={styles.actBlockVal}>{a.notes}</div>
                          </div>
                        )}
                        {/* DELAY REASON block (always labeled — dash if none) */}
                        <div className={styles.actBlock}>
                          <div className={styles.actBlockLbl}>DELAY REASON</div>
                          <div className={styles.actBlockVal}>
                            {(a.reasonLabel || a.reasonNote)
                              ? [a.reasonLabel, a.reasonNote].filter(Boolean).join(" · ")
                              : "—"}
                          </div>
                        </div>
                        <div className={styles.actFoot}>
                          {a.contractorName ?? "Untagged"} · {new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </Section>

      {/* §5 Milestone Progress */}
      <Section
        num="05"
        title="Milestone Progress"
        meta={`line items whose planned finish is on or before ${asOfLabel}`}
      >
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>Milestone</th>
              <th className={styles.tblRight}>Line items due</th>
              <th className={styles.tblRight}>Done</th>
              <th className={styles.tblRight}>Pending</th>
              <th className={styles.tblRight}>Status</th>
            </tr>
          </thead>
          <tbody>
            {s.milestoneProgress.map((row) => (
              <tr key={row.code}>
                <td className={styles.tblName}>{row.name}</td>
                <td className={styles.tblRight}>{row.due === 0 ? "—" : row.due}</td>
                <td className={styles.tblRight}>{row.due === 0 ? "—" : row.done}</td>
                <td className={styles.tblRight}>{row.due === 0 ? "—" : row.pending}</td>
                <td className={styles.tblRight}>
                  {row.status === "not-started" ? (
                    <span className={styles.pillMuted}>Not started</span>
                  ) : row.status === "all-done" ? (
                    <span className={styles.pillGood}>All done</span>
                  ) : (
                    <span className={styles.pillBad}>{row.pending} pending</span>
                  )}
                </td>
              </tr>
            ))}
            {s.milestoneProgress.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>No milestones defined yet.</td></tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* §6 Block-wise Progress */}
      <Section
        num="06"
        title="Block-wise Progress"
        meta="planned vs actual dates + delta per block"
      >
        {s.blockProgress.filter((b) => b.villaCount > 0).length === 0 ? (
          <div className={styles.empty}>No blocks defined yet.</div>
        ) : (
          s.blockProgress
            .filter((b) => b.villaCount > 0)
            .map((b) => (
              <div key={b.blockCode} className={styles.bpRow}>
                <div className={styles.bpHead}>
                  <div>
                    <span className={styles.bpTitle}>Block {b.blockCode}</span>
                    <span className={styles.bpSub}>
                      {b.villaCount} villas · {b.activitiesClosed} of {b.activitiesDue} due closed
                    </span>
                  </div>
                  <div className={`${styles.bpDelay} ${b.delayDays === 0 ? styles.bpDelayZero : ""}`}>
                    {b.delayDays === 0 ? "—" : `+${b.delayDays}d delay`}
                  </div>
                </div>
                <table className={styles.bpTbl}>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th className={styles.tblRight}>Progress</th>
                      <th>Start</th>
                      <th>Finish</th>
                      <th className={styles.tblRight}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Planned</td>
                      <td className={styles.tblRight}>{fmtPct(b.plannedPct)}</td>
                      <td>{fmtShort(b.plannedStart)}</td>
                      <td>{fmtShort(b.plannedFinish)}</td>
                      <td className={styles.tblRight}>{fmtDays(b.plannedDurationDays)}</td>
                    </tr>
                    <tr>
                      <td>Actual</td>
                      <td className={styles.tblRight}>{fmtPct(b.actualPct)}</td>
                      <td>{fmtShort(b.actualStart)}</td>
                      <td>{fmtShort(b.projectedFinish)}</td>
                      <td className={styles.tblRight}>{fmtDays(b.actualDurationDays)}</td>
                    </tr>
                  </tbody>
                </table>
                {b.villas.length > 0 && (
                  <div className={styles.bpVillaRow}>
                    {b.villas.map((n) => (
                      <span key={n} className={styles.bpVillaChip}>V{n}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
        )}
      </Section>

      {/* §7 Project Health footer */}
      <Section num="07" title="Project Health" meta={`as of ${asOfLabel}`}>
        <table className={styles.phTbl}>
          <thead>
            <tr>
              <th>Measure</th>
              <th>Planned</th>
              <th>Actual / Projected</th>
              <th className={styles.tblRight}>Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Start date</td>
              <td>{fmtLong(s.projectHealth.plannedStart)}</td>
              <td>{fmtLong(s.projectHealth.actualStart)}</td>
              <td className={styles.tblRight}>{fmtDaysSigned(s.projectHealth.startVarianceDays)}</td>
            </tr>
            <tr>
              <td>End date</td>
              <td>{fmtLong(s.projectHealth.plannedEnd)}</td>
              <td>{fmtLong(s.projectHealth.projectedEnd)}</td>
              <td className={styles.tblRight}>{fmtDaysSigned(s.projectHealth.endVarianceDays)}</td>
            </tr>
            <tr>
              <td>Duration</td>
              <td>{fmtDays(s.projectHealth.plannedDurationDays)}</td>
              <td>{fmtDays(s.projectHealth.actualDurationDays)}</td>
              <td className={styles.tblRight}>
                {s.projectHealth.plannedDurationDays != null && s.projectHealth.actualDurationDays != null
                  ? fmtDaysSigned(s.projectHealth.actualDurationDays - s.projectHealth.plannedDurationDays)
                  : "—"}
              </td>
            </tr>
            <tr>
              <td>Progress to date</td>
              <td>{fmtPct(s.projectHealth.plannedProgressPct)}</td>
              <td>{fmtPct(s.projectHealth.actualProgressPct)}</td>
              <td className={styles.tblRight}>{fmtPct(s.projectHealth.progressVariancePct)}</td>
            </tr>
            <tr>
              <td>Overall complete</td>
              <td>100.00%</td>
              <td>{fmtPct(s.projectHealth.overallCompletePct)}</td>
              <td className={styles.tblRight}>{fmtPct(-1 * (100 - s.projectHealth.overallCompletePct))}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable section shell
// ---------------------------------------------------------------------------

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
