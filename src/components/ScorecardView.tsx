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
  contractorOptions: Array<{ id: string; name: string }>;
  contractorFilterId: string | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtLong(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScorecardView({
  scorecard: s,
  projectId,
  dateStr,
  contractorOptions,
  contractorFilterId,
}: ScorecardViewProps) {
  const router = useRouter();

  const buildHref = useCallback((next: { date?: string; contractor?: string | null }) => {
    const qs = new URLSearchParams();
    qs.set("date", next.date ?? dateStr);
    const c = next.contractor === undefined ? contractorFilterId : next.contractor;
    if (c) qs.set("contractor", c);
    return `/projects/${projectId}/reports/scorecard?${qs.toString()}`;
  }, [projectId, dateStr, contractorFilterId]);

  const onDateChange = useCallback((v: string) => {
    if (v) router.push(buildHref({ date: v }));
  }, [router, buildHref]);
  const onContractorChange = useCallback((v: string) => {
    router.push(buildHref({ contractor: v || null }));
  }, [router, buildHref]);

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
          <span className={styles.toolbarLbl} style={{ marginLeft: 14 }}>Contractor</span>
          <select
            value={contractorFilterId ?? ""}
            onChange={(e) => onContractorChange(e.target.value)}
            className={styles.toolbarDate}
          >
            <option value="">All contractors</option>
            {contractorOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
                            // "N of M updated" — numerator is planned + ahead;
                            // denominator is the full chip strip (planned + ahead).
                            const done = b.updatedCount + b.aheadCount;
                            const total = b.totalCount + b.aheadCount;
                            return `${done} of ${total} updated`;
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
              <div className={styles.actBlockHd}>Block {g.blockCode}</div>
              {g.villas.map((v) => {
                const count = v.activities.length;
                return (
                  <div key={v.villaNumber}>
                    <div className={styles.actVillaHd}>
                      <span className={styles.actVillaName}>{v.villaLabel}</span>
                      <span className={styles.actVillaCount}>
                        {count} {count === 1 ? "activity" : "activities"} logged
                      </span>
                    </div>
                    <div className={styles.actCards}>
                      {v.activities.map((a) => {
                        const done = a.achievedPct != null && a.achievedPct >= 100;
                        const entryDay = new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                        const entryFull = new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                        const reason = [a.reasonLabel, a.reasonNote].filter(Boolean).join(" · ");
                        return (
                          <div key={a.progressEntryId} className={styles.actCard}>
                            {a.photoUrl ? (
                              <div className={styles.actPhoto}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={a.photoUrl} alt="" />
                              </div>
                            ) : (
                              <div className={styles.actPhotoStub}>Photo not uploaded</div>
                            )}
                            <div className={styles.actInfo}>
                              <div className={styles.actName}>
                                {a.milestoneName} · {a.activityName}
                              </div>
                              {a.achievedPct != null && (
                                <div className={styles.actStatus}>
                                  <span className={`${styles.actPill} ${done ? styles.done : styles.wip}`}>
                                    {Math.round(a.achievedPct)}% complete · {done ? "done" : "in progress"}
                                  </span>
                                </div>
                              )}
                              {a.dailyDeltaPct != null && a.dailyDeltaPct > 0 && (
                                <div className={styles.actDay}>
                                  {a.dailyDeltaPct}% completed on {entryDay}
                                </div>
                              )}
                              {a.plannedEndDate && (
                                <div className={styles.actDelay}>
                                  Planned end {new Date(a.plannedEndDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                  {a.daysToPlannedEnd != null && a.daysToPlannedEnd < 0 && (
                                    <> · <b className={styles.actDelayBad}>{done ? "completed" : ""} {Math.abs(a.daysToPlannedEnd)} days {done ? "late" : "overdue"}</b></>
                                  )}
                                  {a.daysToPlannedEnd != null && a.daysToPlannedEnd > 0 && (
                                    <> · {a.daysToPlannedEnd} days to planned end</>
                                  )}
                                  {a.daysToPlannedEnd === 0 && (
                                    <> · <b className={styles.actDelayBad}>due today</b></>
                                  )}
                                </div>
                              )}
                              {a.notes && (
                                <div className={styles.actField}>
                                  <span className={styles.actFieldLbl}>Remark</span>
                                  {a.notes}
                                </div>
                              )}
                              <div className={styles.actField}>
                                <span className={styles.actFieldLbl}>Delay Reason</span>
                                {reason || "—"}
                              </div>
                              <div className={styles.actFoot}>
                                {a.contractorName ?? "Untagged"} · {entryFull}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Section>

      {/* §5, §6, §7 removed per template — Milestone Progress and Project
          Health live on the Overview / Snapshot tabs; Block-wise Progress
          lives on the Layout tab. The daily Scorecard is the four sections
          above only, matching the Amanvana template. */}
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
