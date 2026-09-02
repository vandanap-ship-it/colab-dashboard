"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import styles from "./scorecard.module.css";
import weekly from "./weekly-report.module.css";
import type { WeeklyReport, WeeklyMilestoneItem } from "@/lib/weeklyReportServer";

// Weekly Report — ported from Amanvana Reporting Toolkit v14
// scripts/gen_wk30.py HTML template. Structure + class semantics mirror
// the Python-generated HTML so the rendered result matches
// Amanvana_Phase1_Weekly_wk30.pdf.

export interface WeeklyReportViewProps {
  report: WeeklyReport;
  projectId: string;
  weekEndingStr: string; // YYYY-MM-DD
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
/** "Sun 23 Aug" — Python's wk_end format for narrative sentences (§1 subtitle,
 *  §3 footnote, foot). Card labels keep the day-only form. */
function fmtDayFull(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}
function fmtPct(n: number): string { return `${n.toFixed(2)}%`; }
function itemsLbl(list: string[], n = 8): string {
  if (!list.length) return "none";
  const extra = list.length > n ? ` +${list.length - n} more` : "";
  return list.slice(0, n).join(", ") + extra;
}
function chipLabel(i: WeeklyMilestoneItem): string {
  return `V${i.villaNumber.toString().padStart(2, "0")} ${i.milestoneName}`;
}
function fmtIsoDayShort(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function reasonColor(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("design") || r.includes("scope")) return "#8E2D1E";
  if (r.includes("drawing")) return "#B5561F";
  if (r.includes("material")) return "#9A6A1F";
  if (r.includes("vendor")) return "#965532";
  if (r.includes("priorit")) return "#CA9F49";
  if (r.includes("manpower") || r.includes("labour")) return "#73823C";
  return "#A0A09B";
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

  // Python-parity: "17–23 Aug 2026" when the month is the same on both sides,
  // otherwise "27 Aug – 2 Sep 2026" style. Second hero line always renders
  // "Week ending Sun 23 Aug".
  const sameMonth = report.weekStart.getUTCMonth() === report.weekEnd.getUTCMonth();
  const wkLabel = sameMonth
    ? `${report.weekStart.getUTCDate()}–${report.weekEnd.getUTCDate()} ${report.weekEnd.toLocaleDateString("en-GB", { month: "short" })} ${report.weekEnd.getFullYear()}`
    : `${fmtDayShort(report.weekStart)} – ${fmtDayShort(report.weekEnd)} ${report.weekEnd.getFullYear()}`;
  const wkEndStr = fmtDayShort(report.weekEnd);
  const wkEndStrFull = fmtDayFull(report.weekEnd); // "Sun 23 Aug" — narrative form
  // Project display name: DB stores "Amanvana - Phase 1" but Python's PDF
  // uses "Amanvana · Phase 1" (interpunct) in the header eyebrow.
  const projectDisplay = report.project.name.replace(/\s+-\s+/g, " · ");

  // Abraham (Contractor 1) is the only party in the milestone maths per spec.
  // Elegant renders as a name-only strip. Untagged bucket already dropped
  // upstream (weeklyReportServer.ts).
  const p1 = report.milestonePlans.find((m) => m.contractorName.trim().toLowerCase() !== "elegant construction" && m.hasSchedule);
  const elegant = report.milestonePlans.find((m) => m.contractorName.trim().toLowerCase() === "elegant construction");

  return (
    <>
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
          <span className={styles.toolbarLbl} style={{ marginLeft: 14 }}>Range</span>
          <span className={styles.toolbarDate} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtDayFull(report.weekStart)} – {fmtDayFull(report.weekEnd)} {report.weekEnd.getFullYear()}
          </span>
        </div>
        <button type="button" onClick={onDownload} className={styles.toolbarBtn}>
          <Download size={14} aria-hidden />
          Download PDF
        </button>
      </div>

      <div className={weekly.page}>
        {/* Head */}
        <div className={weekly.hero}>
          <div className={weekly.heroLeft}>
            <div className={weekly.heroCrumb}>
              <span className={weekly.heroCrumbDot} />
              White Lotus Group · {projectDisplay}
            </div>
            <div className={weekly.heroTitle}>Weekly Progress <span>Report</span></div>
          </div>
          <div className={weekly.heroDate}>
            <div className={weekly.heroDateVal}>{wkLabel}</div>
            <div className={weekly.heroDateSub}>Week ending {wkEndStrFull}</div>
          </div>
        </div>

        {/* §1 Overall Project Progress */}
        <div className={weekly.sec}>
          <div className={weekly.sechd}>
            <div className={weekly.secNum}>01</div>
            <h2 className={weekly.secTitle}>Overall Project Progress</h2>
            <div className={weekly.secNote}>progress required by {wkEndStrFull} vs achieved</div>
          </div>
          <div className={weekly.snap}>
            <div className={weekly.snapRow}>
              <div className={weekly.snapCell}>
                <div className={weekly.snapLbl}>Target — due by {wkEndStr}</div>
                <div className={weekly.snapVal}>{fmtPct(report.overall.plannedPct)}</div>
              </div>
              <div className={weekly.snapCell}>
                <div className={weekly.snapLbl}>Actual — achieved</div>
                <div className={`${weekly.snapVal} ${weekly.snapValAct}`}>{fmtPct(report.overall.actualPct)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* §2 Weekly Milestone Plan */}
        <div className={weekly.sec}>
          <div className={weekly.sechd}>
            <div className={weekly.secNum}>02</div>
            <h2 className={weekly.secTitle}>Weekly Milestone Plan — Contractor-wise</h2>
            <div className={weekly.secNote}>planned vs actual · this week + spill-over from earlier</div>
          </div>

          {p1 && (
            <>
              <div className={weekly.cbar}>
                <span className={weekly.cbarName}>Contractor 1 — {p1.contractorName}</span>
                <span className={weekly.cbarNote}>41 villas · full schedule loaded</span>
                <span className={`${weekly.cbarPill} ${weekly.cbarPillActive}`}>Active</span>
              </div>

              <div className={weekly.mcards}>
                <MilestoneCardV2
                  variant="done"
                  title="Milestones to complete"
                  numer={p1.toComplete.closed}
                  denom={p1.toComplete.total}
                  labelLine={<>closed this week<br />of planned finishes</>}
                  postText={<>planned but not closed: <b>{p1.toComplete.items.length ? itemsLbl(p1.toComplete.items.map(chipLabel)) : "none"}</b></>}
                  spill={{
                    title: "Spilled over from earlier",
                    count: p1.overdue.total,
                    note: p1.overdue.total > 0 ? `overdue, still open: ${itemsLbl(p1.overdue.items.map(chipLabel))}` : "none",
                  }}
                />
                <MilestoneCardV2
                  title="Milestones to start"
                  numer={p1.toStart.started}
                  denom={p1.toStart.total}
                  labelLine={<>started this week<br />of planned starts</>}
                  postText={<>planned but not started: <b>{p1.toStart.notStartedItems.length > 0 ? itemsLbl(p1.toStart.notStartedItems.map(chipLabel)) : "none"}</b></>}
                  spill={{
                    title: "Spilled over from earlier",
                    count: p1.toStart.spill,
                    note: p1.toStart.spill > 0 ? `should have started: ${itemsLbl(p1.toStart.spillItems.map(chipLabel))}` : "none",
                  }}
                />
                <MilestoneCardV2
                  title="Milestones in progress"
                  numer={p1.inProgress.moving}
                  denom={p1.inProgress.total}
                  labelLine={<>actually moving<br />of planned in progress</>}
                  postText={<>the rest are moving on site</>}
                  spill={{
                    title: "Not moving",
                    count: p1.inProgress.stalled,
                    note: p1.inProgress.stalled > 0 ? `no progress logged this week: ${itemsLbl(p1.inProgress.stalledItems.map(chipLabel))}` : "none",
                    plainCount: true,
                  }}
                />
              </div>

              <div className={weekly.mnote}>
                One milestone = a villa&apos;s current construction stage. <b>To complete</b> and <b>in progress</b> overlap where a stage is due to finish this week. Spill-over = stages whose planned date has already passed and are still open or not started. Read Planned → Actual left to right in each card.
              </div>
            </>
          )}

          {elegant && (
            <div className={weekly.c2}>
              <span className={weekly.c2N}>Contractor 2 — {elegant.contractorName}</span>
              <span className={weekly.c2T}>52 villas · Awarded — 52 villas across 12 blocks. Schedule received; integration with the collab tools under process.</span>
              <span className={weekly.c2P}>Schedule received</span>
            </div>
          )}
        </div>

        {/* §3 Milestone breakdown */}
        {p1 && (
          <div className={weekly.sec}>
            <div className={weekly.sechd}>
              <div className={weekly.secNum}>03</div>
              <h2 className={weekly.secTitle}>Milestone breakdown</h2>
              <div className={weekly.secNote}>the villas inside each of the three metrics above</div>
            </div>

            {/* To complete */}
            <div className={weekly.dtable}>
              <div className={`${weekly.dgrp} ${weekly.dgrpA}`}>
                ① To complete — {p1.toComplete.total + p1.overdue.total} milestones due, {p1.toComplete.closed} closed
              </div>
              <BreakdownTable
                mode="complete"
                rows={[
                  ...p1.overdue.items.map((it) => ({ ...it, tag: "spilled" as const })),
                  ...p1.toComplete.items.map((it) => ({ ...it, tag: "this-week" as const })),
                ].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))}
              />
            </div>

            {/* To start */}
            <div className={weekly.dtable}>
              <div className={`${weekly.dgrp} ${weekly.dgrpB}`}>
                ② To start — {p1.toStart.total + p1.toStart.spill} milestones due, {p1.toStart.started} started
              </div>
              <BreakdownTable
                mode="start"
                rows={[
                  ...p1.toStart.spillItems.map((it) => ({ ...it, tag: "spilled" as const })),
                  ...p1.toStart.items.map((it) => ({ ...it, tag: "this-week" as const })),
                ].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))}
              />
            </div>

            {/* In progress (dark navy panel) */}
            <div className={weekly.ipwrap}>
              <div className={weekly.ipbar}>
                <span className={weekly.ipt}>③ In progress — {p1.inProgress.total} milestones</span>
                <span className={weekly.ipsplit}>
                  <span className={weekly.ipMoving}>{p1.inProgress.moving} moving</span> · <span className={weekly.ipStalled}>{p1.inProgress.stalled} stalled</span>
                </span>
              </div>
              <div className={weekly.ipmoving}>
                <div className={weekly.ipml}>Moving on site</div>
                {p1.inProgress.movingItems.map((r) => (
                  <span key={`${r.villaNumber}-${r.milestoneName}`} className={weekly.chip}>
                    V{r.villaNumber.toString().padStart(2, "0")} <small>{r.milestoneName}</small>
                  </span>
                ))}
              </div>
              <div className={weekly.nmhd} style={{ marginTop: 16 }}>
                <div className={weekly.nmt2}>Stalled <span>· needs a push</span></div>
                <div className={weekly.nms2}>Planned to be under way but <b>zero progress logged</b> — stalled, not slow. Bar length = days idle.</div>
              </div>
              <StalledPanelV2 items={p1.inProgress.stalledItems} weekEnd={report.weekEnd} />
            </div>

            <div className={weekly.mnote}>
              A milestone can appear in more than one metric — a stage due to finish this week is also in progress this week. &quot;Days past&quot; counts from the planned finish; &quot;days idle&quot; from the planned start; both to {wkEndStrFull}. <b>Delay reason</b>{" "}is pulled from the sub-task rows (tracker-update notes filtered out). &quot;This week&quot; vs &quot;spilled&quot; tells you whether the milestone belongs to this week&apos;s plan or carried over from an earlier week.
            </div>
          </div>
        )}

        {/* §4 Manpower */}
        <div className={weekly.sec}>
          <div className={weekly.sechd}>
            <div className={weekly.secNum}>04</div>
            <h2 className={weekly.secTitle}>Manpower — target vs achieved</h2>
            <div className={weekly.secNote}>headcount planned vs on site · contractor-wise · numbers and %</div>
          </div>

          {report.manpowerByContractor.filter((c) => c.hasPlan).map((c) => {
            const totalDays = c.perDay.length || 7;
            const workingDays = c.perDay.filter((d) => !d.isHoliday).length;
            const loggedDays = c.perDay.filter((d) => d.actualTotal > 0).length;
            const planPerDay = workingDays > 0 ? Math.round(c.weeklyPlanned / workingDays) : 0;
            const avgActualPerDay = totalDays > 0 ? Math.round(c.weeklyActual / totalDays) : 0;
            const pct = c.pctOfPlan ?? 0;
            const pctColor = pct >= 100 ? "#8CA04A" : "#C9756A";
            return (
              <div key={c.contractorId}>
                <div className={weekly.cbar}>
                  <span className={weekly.cbarName}>Contractor 1 — {c.contractorName}</span>
                  <span className={weekly.cbarNote}>all site labour is under Contractor 1</span>
                  <span className={`${weekly.cbarPill} ${weekly.cbarPillActive}`}>Active</span>
                </div>
                <div className={weekly.mpwrap}>
                  <div className={weekly.mptotal}>
                    <div className={weekly.mptCell}>
                      <div className={weekly.mptL}>Weekly target (labour-days)</div>
                      <div className={weekly.mptV}>{c.weeklyPlanned}</div>
                      <div className={weekly.mptSub}>{planPerDay}/day × {workingDays} days</div>
                    </div>
                    <div className={weekly.mptCell}>
                      <div className={weekly.mptL}>Achieved (labour-days)</div>
                      <div className={`${weekly.mptV} ${weekly.mptVAct}`}>{c.weeklyActual}</div>
                      <div className={weekly.mptSub}>{loggedDays} of {totalDays} days logged</div>
                    </div>
                    <div className={weekly.mptCell}>
                      <div className={weekly.mptL}>Week achieved vs target</div>
                      <div className={weekly.mptV} style={{ color: pctColor }}>{pct}%</div>
                      <div className={weekly.mptSub}>avg {avgActualPerDay}/day on site</div>
                    </div>
                  </div>
                  <div className={weekly.mpchart}>
                    <div className={weekly.mpctH}>Total labour — planned vs actual by day</div>
                    <ManpowerChart perDay={c.perDay} />
                  </div>
                  <div className={weekly.mpday}>
                    Date-wise count (actual / planned). Attendance logged <b>{loggedDays === totalDays ? "every day this week" : `${loggedDays} of ${totalDays} days this week`}</b>.
                  </div>
                  <div className={weekly.dwwrap}>
                    <ManpowerTradeTable perDay={c.perDay} />
                  </div>
                </div>
              </div>
            );
          })}

          {elegant && (
            <div className={weekly.c2}>
              <span className={weekly.c2N}>Contractor 2 — {elegant.contractorName}</span>
              <span className={weekly.c2T}>52 villas · schedule received; collab-tool integration under process, so no manpower feed yet.</span>
              <span className={weekly.c2P}>Schedule received</span>
            </div>
          )}
        </div>

        {/* §5 Delay Reasons & Mitigation */}
        <div className={weekly.sec}>
          <div className={weekly.sechd}>
            <div className={weekly.secNum}>05</div>
            <h2 className={weekly.secTitle}>Delay Reasons &amp; Mitigation</h2>
            <div className={weekly.secNote}>every cause · average delay it caused · the fix</div>
          </div>

          {report.delayReasons.length === 0 ? (
            <div className={styles.empty}>No open hindrances tagged this week. Excellent.</div>
          ) : (
            <>
              <div className={weekly.rzwrap}>
                <div className={weekly.rzlead}>
                  Every recorded cause · normalised buckets · the days each is costing. Villas not listed are delayed with no reason logged.
                </div>
                <table className={weekly.rzTable}>
                  <thead>
                    <tr>
                      <th>Delay reason</th>
                      <th>Avg delay</th>
                      <th>Worst</th>
                      <th>Activities</th>
                      <th>Villas</th>
                      <th>Which villas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.delayReasons.map((r) => (
                      <tr key={r.code}>
                        <td className={weekly.rzR}>
                          <span className={weekly.rzDot} style={{ background: reasonColor(r.label) }} />
                          {r.label}
                        </td>
                        <td className={weekly.rzLate}>{r.avgDaysImpact > 0 ? `${r.avgDaysImpact}d` : "-"}</td>
                        <td>{r.maxDaysImpact > 0 ? `${r.maxDaysImpact}d` : "-"}</td>
                        <td>{r.activityCount}</td>
                        <td style={{ fontWeight: 800 }}>{r.affectedVillas.length}</td>
                        <td className={weekly.rzV}>{r.affectedVillas.map((n) => `V${n.toString().padStart(2, "0")}`).slice(0, 24).join(", ")}{r.affectedVillas.length > 24 ? ` +${r.affectedVillas.length - 24}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={weekly.mzhd}>Mitigation &amp; recovery <span>· the action against each cause</span></div>
              <div className={weekly.rzwrap}>
                <table className={weekly.rzTable}>
                  <thead>
                    <tr>
                      <th>Delay reason</th>
                      <th>Mitigation action</th>
                      <th>Owner</th>
                      <th>Target date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.delayReasons.map((r) => (
                      <tr key={r.code}>
                        <td className={weekly.rzR}>
                          <span className={weekly.rzDot} style={{ background: reasonColor(r.label) }} />
                          {r.label}
                        </td>
                        <td className={weekly.mzAct}>{r.mitigation}</td>
                        <td className={weekly.mzFill}><span className={weekly.mzNone}>assign</span></td>
                        <td className={weekly.mzFill}><span className={weekly.mzNone}>set date</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={weekly.mnote}>
                <b>How to capture mitigation:</b> the tracker does not have a mitigation field, so it lives here in a fixed format — <i>reason → action → owner → target date</i>. The actions above are suggested starting points; put real mitigation, owner and recovery date next to each cause once agreed.
              </div>
            </>
          )}
        </div>

        <div className={weekly.foot}>
          Week defined Mon–Sun, ending {wkEndStrFull} {report.weekEnd.getFullYear()}. Contractor 1 (Abraham Thomas) is the only party with a loaded schedule; Contractor 2 (Elegant Construction) is awarded with 52 villas across 12 blocks; its schedule has been received and integration with the collab tools is under process, so it carries no milestones here yet. Milestone dates are stage-level (all activities in a stage), not the tracker&apos;s single END-marker date, so they reflect true stage finish.
        </div>
      </div>
    </>
  );
}

// -------- Milestone card v2 (mirrors gen_wk30.py .mc) --------
function MilestoneCardV2({
  variant, title, numer, denom, labelLine, postText, spill,
}: {
  variant?: "done";
  title: string;
  numer: number;
  denom: number;
  labelLine: React.ReactNode;
  postText: React.ReactNode;
  spill: { title: string; count: number; note: string; plainCount?: boolean };
}) {
  const pct = denom > 0 ? Math.round((numer / denom) * 100) : 0;
  const barColor = pct >= 80 ? "#8CA04A" : pct >= 40 ? "#B5561F" : "#8E2D1E";
  const barPctColor = pct >= 80 ? "#73823C" : pct >= 40 ? "#B5561F" : "#8E2D1E";
  return (
    <div className={`${weekly.mc} ${variant === "done" ? weekly.mcDone : ""}`}>
      <h3 className={weekly.mcH3}>{title}</h3>
      <div className={weekly.mcPa}>
        <span className={weekly.mcBig}>{numer}</span>
        <span className={weekly.mcOf}>/ {denom}</span>
        <span className={weekly.mcLb}>{labelLine}</span>
      </div>
      <div className={weekly.tabar}>
        <div className={weekly.tafill} style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
      </div>
      <div className={weekly.tapct} style={{ color: barPctColor }}>{pct}%</div>
      <div className={weekly.si2}>{postText}</div>
      <div className={weekly.spill}>
        <div className={weekly.spillH}>{spill.title}</div>
        <div className={weekly.spillN}>{spill.plainCount ? spill.count : `+${spill.count}`}</div>
        <div className={weekly.spillI}>{spill.note}</div>
      </div>
    </div>
  );
}

// -------- Breakdown table (§3) --------
type BreakdownRow = WeeklyMilestoneItem & { tag: "spilled" | "this-week" };
function BreakdownTable({ mode, rows }: { mode: "complete" | "start"; rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return <div style={{ padding: "12px 16px", fontSize: 12, color: "#8a8a84" }}>Nothing in this bucket this week.</div>;
  }
  return (
    <table className={weekly.dTable}>
      <thead>
        <tr>
          <th>Villa</th>
          <th>Block</th>
          <th>Milestone</th>
          <th>{mode === "complete" ? "Planned finish" : "Planned start"}</th>
          <th>{mode === "complete" ? "Days past" : "Days idle"}</th>
          <th>When due</th>
          <th>{mode === "complete" ? "On site?" : "Started?"}</th>
          <th>Delay reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const days = r.daysLate ?? 0;
          const started = !!r.started;
          const plannedIso = mode === "complete" ? r.plannedFinish : r.plannedStart;
          return (
            <tr key={`${r.villaNumber}-${r.milestoneName}-${i}`}>
              <td className={weekly.dVv}>V{r.villaNumber.toString().padStart(2, "0")}</td>
              <td>Block {r.blockCode}</td>
              <td>{r.milestoneName}</td>
              <td>{fmtIsoDayShort(plannedIso)}</td>
              <td className={mode === "complete" ? weekly.dLate : weekly.dWarn}>{days}d</td>
              <td>
                <span className={`${weekly.srcp} ${r.tag === "spilled" ? weekly.srcpSp : weekly.srcpTw}`}>
                  {r.tag === "spilled" ? "spilled" : "this week"}
                </span>
              </td>
              <td>
                <span className={`${weekly.stPill} ${started ? weekly.stOn : weekly.stOff}`}>
                  {mode === "complete" ? (started ? "being worked" : "not started") : (started ? "started" : "not started")}
                </span>
              </td>
              <td className={weekly.dRsn}>{r.reason ?? <span className={weekly.dNone}>not recorded</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// -------- Stalled aging bar panel v2 (dark navy rows) --------
function StalledPanelV2({ items, weekEnd }: { items: WeeklyMilestoneItem[]; weekEnd: Date }) {
  if (items.length === 0) {
    return <div className={weekly.nmempty}>Nothing stalled - every planned milestone is moving on site.</div>;
  }
  const mx = Math.max(1, ...items.map((r) => r.daysIdle ?? 0));
  return (
    <div className={weekly.nmpanel}>
      {items.map((r, i) => {
        const d = r.daysIdle ?? 0;
        const col = d >= 14 ? "#8E2D1E" : d >= 7 ? "#B5561F" : "#CA9F49";
        const w = Math.max(6, Math.round((d / mx) * 100));
        // Python gen_wk30.py L96: `since {r["date"]}` where date = dmy(s['ps']),
        // i.e. the planned START. Fallback to weekEnd only if planned start
        // is missing (should never happen for stalled items — they're stalled
        // BECAUSE the planned start has passed).
        const since = r.plannedStart
          ? new Date(r.plannedStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
          : fmtDayShort(weekEnd);
        const reason = r.reason ?? "no cause logged";
        return (
          <div key={`${r.villaNumber}-${r.milestoneName}-${i}`} className={weekly.nmrow}>
            <div className={weekly.nmv}>
              <span className={weekly.nmvn}>V{r.villaNumber.toString().padStart(2, "0")}</span>
              <span className={weekly.nmvs}>{r.milestoneName} · Block {r.blockCode}</span>
            </div>
            <div className={weekly.nmbarwrap}>
              <div className={weekly.nmbar}>
                <i style={{ width: `${w}%`, background: col }} />
              </div>
              <span className={weekly.nmd} style={{ color: col }}>{d}d idle</span>
            </div>
            <div className={`${weekly.nmr} ${r.reason ? "" : weekly.nmrNolog}`}>{reason}</div>
            <div className={weekly.nmact}>since {since}</div>
          </div>
        );
      })}
    </div>
  );
}

// -------- Manpower chart (SVG bar, per-day planned vs actual) --------
function ManpowerChart({ perDay }: { perDay: WeeklyReport["manpowerByContractor"][number]["perDay"] }) {
  const W = 752, H = 250;
  const ml = 34, mr = 10, mt = 22, mb = 24;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const dates = perDay.map((d) => new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));
  const planned = perDay.map((d) => d.plannedTotal);
  const actual = perDay.map((d) => d.actualTotal);
  const holidays = perDay.map((d) => !!d.isHoliday);
  const maxVal = Math.max(...planned, ...actual, 0);
  const ymax = Math.max(60, Math.ceil((maxVal + 9) / 10) * 10);
  const y = (v: number) => mt + ph - (v / ymax) * ph;
  const n = perDay.length || 1;
  const gw = pw / n;
  const bw = gw * 0.30;
  const gap = gw * 0.06;
  const pc = "#9CC9E0";
  const ac = "#A7D98C";
  return (
    <>
      <div className={weekly.mpleg}>
        <span><i style={{ background: pc }} />Planned labour</span>
        <span><i style={{ background: ac }} />Actual labour</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" xmlns="http://www.w3.org/2000/svg" fontFamily="Open Sans,sans-serif">
        {Array.from({ length: Math.floor(ymax / 10) + 1 }, (_, i) => i * 10).map((gv) => (
          <g key={gv}>
            <line x1={ml} y1={y(gv)} x2={W - mr} y2={y(gv)} stroke="#e8e1d3" strokeWidth={1} />
            <text x={ml - 6} y={y(gv) + 3} fontSize={9} fill="#9a9488" textAnchor="end">{gv}</text>
          </g>
        ))}
        {dates.map((d, i) => {
          const cx = ml + i * gw + gw / 2;
          const pv = planned[i];
          const av = actual[i];
          if (holidays[i]) {
            return (
              <g key={i}>
                <rect x={ml + i * gw} y={mt} width={gw} height={ph} fill="#f0ece2" />
                <text x={cx} y={mt + ph / 2} fontSize={9.5} fill="#a79f8f" textAnchor="middle" transform={`rotate(-90 ${cx} ${mt + ph / 2})`}>HOLIDAY</text>
                <text x={cx} y={H - 8} fontSize={8.5} fill="#7a7a72" textAnchor="middle">{d}</text>
              </g>
            );
          }
          const px = cx - bw - gap / 2;
          const ax = cx + gap / 2;
          return (
            <g key={i}>
              <rect x={px} y={y(pv)} width={bw} height={ph - (y(pv) - mt)} fill={pc} rx={2} />
              <text x={px + bw / 2} y={y(pv) - 4} fontSize={9.5} fill="#5a5a54" textAnchor="middle">{pv}</text>
              {av > 0 ? (
                <>
                  <rect x={ax} y={y(av)} width={bw} height={ph - (y(av) - mt)} fill={ac} rx={2} />
                  <text x={ax + bw / 2} y={y(av) - 4} fontSize={9.5} fill="#4E7A46" textAnchor="middle" fontWeight={700}>{av}</text>
                </>
              ) : (
                <text x={ax + bw / 2} y={y(0) - 4} fontSize={9.5} fill="#b8b2a6" textAnchor="middle">0</text>
              )}
              <text x={cx} y={H - 8} fontSize={8.5} fill="#7a7a72" textAnchor="middle">{d}</text>
            </g>
          );
        })}
        <line x1={ml} y1={y(0)} x2={W - mr} y2={y(0)} stroke="#cbc3b4" strokeWidth={1.2} />
      </svg>
    </>
  );
}

// -------- Manpower per-trade per-day table --------
function ManpowerTradeTable({ perDay }: { perDay: WeeklyReport["manpowerByContractor"][number]["perDay"] }) {
  const dates = perDay.map((d) => new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));
  const holidays = perDay.map((d) => !!d.isHoliday);
  // Union of trades across all days.
  const tradeSet = new Set<string>();
  for (const d of perDay) for (const t of d.trades) tradeSet.add(t.trade);
  const trades = Array.from(tradeSet);
  const cell = (val: string, isHol: boolean) => isHol ? "Hol" : val;
  return (
    <table className={weekly.dwTable}>
      <thead>
        <tr>
          <th>Trade</th>
          {dates.map((d, i) => (
            <th key={i} className={holidays[i] ? "hol" : ""}>{d}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t}>
            <td className="tt">{t}</td>
            {perDay.map((d, i) => {
              const tr = d.trades.find((x) => x.trade === t);
              const val = tr ? `${tr.actual}/${tr.planned}` : "-";
              return <td key={i} className={holidays[i] ? "hol" : ""}>{cell(val, holidays[i])}</td>;
            })}
          </tr>
        ))}
        <tr className="dwtot">
          <td className="tt">Total</td>
          {perDay.map((d, i) => {
            const val = `${d.actualTotal}/${d.plannedTotal}`;
            return <td key={i} className={holidays[i] ? "hol" : ""}>{cell(val, holidays[i])}</td>;
          })}
        </tr>
      </tbody>
    </table>
  );
}
