"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
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

  const onPrint = useCallback(() => {
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
        <button type="button" onClick={onPrint} className={styles.toolbarBtn}>
          <Printer size={14} aria-hidden />
          Download / Print
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

      {/* §1 Daily Site Snapshot */}
      <Section num="01" title="Daily Site Snapshot" meta={`reporting cadence · ${asOfLabel}`}>
        <div className={styles.snap}>
          <div className={styles.snapCell}>
            <div className={styles.snapKey}>Site progress updated</div>
            <div className={styles.snapValue}>
              {s.dailySnapshot.progressUpdatedToday ? "Yes" : "No"}
              <span className={styles.of}>/ {s.dailySnapshot.contractorsExpected} contractors</span>
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

      {/* §2 Daily Movement — Contractor-wise Progress */}
      <Section num="02" title="Daily Movement — Contractor-wise Progress" meta={`progressed on the day · ${asOfLabel}`}>
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
            {s.movement.map((row) => (
              <tr key={row.contractorId}>
                <td>
                  <div className={styles.tblName}>{row.contractorName}</div>
                  {!row.hasSchedule && (
                    <div className={styles.tblSub}>schedule yet to be received</div>
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
      </Section>

      {/* §3 Planned coverage by block */}
      <Section
        num="03"
        title="Planned coverage by block"
        meta={
          s.blockCoverage.length === 0
            ? "no work planned today"
            : `coverage of the ${s.blockCoverage.length} block${s.blockCoverage.length === 1 ? "" : "s"} with work planned for ${asOfLabel}`
        }
      >
        {s.blockCoverage.length === 0 ? (
          <div className={styles.empty}>No planned coverage for this day.</div>
        ) : (
          s.blockCoverage.map((b) => (
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
                    ? `${b.updatedCount} of ${b.totalCount} updated`
                    : "None updated"}
                </div>
              </div>
              <div className={styles.bcVillas}>
                {b.villas.map((v) => (
                  <span
                    key={v.villaNumber}
                    className={`${styles.bcChip} ${v.updated ? styles.bcChipUpdated : styles.bcChipNotUpdated}`}
                  >
                    V{v.villaNumber}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </Section>

      {/* §4 Daily Manpower */}
      <Section num="04" title="Daily Manpower" meta={`present vs planned · ${asOfLabel}`}>
        {!s.manpower.hasEntries && s.manpower.plannedTotal === 0 ? (
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
          </>
        )}
      </Section>

      {/* §5 Site Activity Highlights */}
      <Section
        num="05"
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
                        <div className={styles.actPhotoStub}>No photo</div>
                      )}
                      <div className={styles.actInfo}>
                        <div className={styles.actEyebrow}>{a.milestoneName}</div>
                        <div className={styles.actName}>{a.activityName}</div>
                        <div className={styles.actMeta}>
                          {a.achievedPct != null && <span className={styles.actPct}>{Math.round(a.achievedPct)}%</span>}
                          {a.overdueDays != null && <span className={styles.actOverdue}>{a.overdueDays}d overdue</span>}
                        </div>
                        {a.notes && <div className={styles.actRemark}>“{a.notes}”</div>}
                        {(a.reasonLabel || a.reasonNote) && (
                          <div className={styles.actReason}>
                            <strong>Delay reason: </strong>
                            {a.reasonLabel ?? ""}{a.reasonLabel && a.reasonNote ? " · " : ""}
                            {a.reasonNote ?? ""}
                          </div>
                        )}
                        <div className={styles.actFoot}>
                          {a.contractorName ?? "—"} · {a.loggedByName}
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

      {/* §6 Milestone Progress */}
      <Section
        num="06"
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

      {/* §7 Block-wise Progress */}
      <Section
        num="07"
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

      {/* §8 Project Health footer */}
      <Section num="08" title="Project Health" meta={`as of ${asOfLabel}`}>
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
