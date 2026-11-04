"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import styles from "./progress-tab.module.css";
import type {
  InteractiveDrawingData,
  ProgressHeroStats,
  SectionProgressRow,
  VillaProgressRow,
  VillaSectionStatus,
} from "@/lib/progressTabServer";

export interface ProgressTabViewProps {
  projectId: string;
  hero: ProgressHeroStats;
  sectionProgress: SectionProgressRow[];
  villaRows: VillaProgressRow[];
  drawingData: InteractiveDrawingData;
}

export default function ProgressTabView({
  projectId,
  hero,
  sectionProgress,
  villaRows,
  drawingData,
}: ProgressTabViewProps) {
  return (
    <div className={styles.wrap}>
      <ProgressHero stats={hero} />
      <SectionProgressCard rows={sectionProgress} />
      {/* Section filter (scannable bucket view) before the detailed villa
          table - top-down dissection per Vandana 2026-11-04. */}
      <SectionFilterCard projectId={projectId} data={drawingData} />
      <VillaProgressCard projectId={projectId} rows={villaRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// §0 - Progress hero (pyramid shape)
//
// One headline metric at the top: Net schedule variance in days. Positive
// = net behind, negative = net ahead. The headline dissects into three
// smaller supporting tiles so management sees how we got to the net
// number: behind count × mean days, ahead count × mean days, completion
// rate of what was planned to close by today.
//
// Vandana + boss, 2026-11-04 pyramid pass + net-delay request: a schedule
// metric that only counts slippage reads unfair - work completed ahead of
// plan should offset it. This metric nets both sides.
// ---------------------------------------------------------------------------

function ProgressHero({ stats }: { stats: ProgressHeroStats }) {
  // Completion rate = % of the WHOLE PROJECT done, not just "of what was
  // planned by today". Vandana 2026-11-05: management asks "how far
  // along are we overall?", not "how much of today's quota did we hit?".
  const wholeClosedPct = stats.totalMilestonesWhole === 0
    ? 0
    : Math.round((stats.closedMilestonesWhole / stats.totalMilestonesWhole) * 100);
  const behindCount = stats.openPastDue + Math.max(0, stats.closedByToday - stats.aheadCount);
  // Visual tone on the net number: bad if net-behind, good if net-ahead.
  const net = stats.netDaysVariance;
  const netTone = net > 15 ? styles.phBad : net > 0 ? styles.phWarn : styles.phGood;
  const netLabel = net === 0
    ? "On schedule"
    : net > 0
      ? `${net} days behind`
      : `${Math.abs(net)} days ahead`;

  return (
    <section className={`${styles.card} ${styles.hero}`}>
      <div className={styles.cardHd}>
        <h3>Overall picture · today</h3>
        <span className={styles.meta}>
          net schedule variance across every milestone that has already hit its baseline
        </span>
      </div>
      <div className={styles.heroMainRow}>
        <div className={styles.heroMain}>
          <div className={styles.heroLbl}>Net schedule variance</div>
          <div className={`${styles.heroMainVal} ${netTone}`}>
            {net > 0 ? "+" : net < 0 ? "-" : ""}{Math.abs(net)}
            <span className={styles.heroMainUnit}>{Math.abs(net) === 1 ? "day" : "days"}</span>
          </div>
          <div className={styles.heroSub}>{netLabel} · {stats.evaluatedCount} milestones evaluated</div>
        </div>
        <div className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Behind</div>
          <div className={`${styles.heroSupportVal} ${styles.phBad}`}>+{stats.meanDaysBehind}d</div>
          <div className={styles.heroSupportSub}>
            mean across {behindCount || stats.openPastDue} overdue milestones
          </div>
        </div>
        <div className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Ahead</div>
          <div className={`${styles.heroSupportVal} ${styles.phGood}`}>-{stats.meanDaysAhead}d</div>
          <div className={styles.heroSupportSub}>
            mean across {stats.aheadCount} early-finish milestones
          </div>
        </div>
        <div className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Project completion</div>
          <div className={styles.heroSupportVal}>{wholeClosedPct}%</div>
          <div className={styles.heroSupportSub}>
            {stats.closedMilestonesWhole} of {stats.totalMilestonesWhole} milestones done across the whole project
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// §1 - Planned vs Actual per section
// ---------------------------------------------------------------------------

function SectionProgressCard({ rows }: { rows: SectionProgressRow[] }) {
  const maxPct = Math.max(100, ...rows.map((r) => Math.max(r.plannedPct, r.actualPct)));
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Planned vs Actual · per milestone section</h3>
        <span className={styles.meta}>% of villas that reached each section · click a row for the task breakdown</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No milestone sections defined yet.</div>
        ) : (
          <div className={styles.spList}>
            {rows.map((r) => {
              const isOpen = expanded === r.code;
              const toggle = () => setExpanded(isOpen ? null : r.code);
              return (
                <div key={r.code} className={styles.spRowWrap}>
                  <button
                    type="button"
                    onClick={toggle}
                    className={`${styles.spRow} ${styles.spRowBtn} ${isOpen ? styles.spRowOpen : ""}`}
                    aria-expanded={isOpen}
                  >
                    <div className={styles.spLbl}>
                      <div className={styles.spName}>
                        <span className={styles.spChev}>{isOpen ? "▾" : "▸"}</span>
                        {r.name}
                      </div>
                      <div className={styles.spMeta}>{r.totalVillas} villas total</div>
                    </div>
                    <div className={styles.spBars}>
                      <BarRow name="Planned" pct={r.plannedPct} maxPct={maxPct} tone="planned" />
                      <BarRow name="Actual" pct={r.actualPct} maxPct={maxPct} tone="actual" />
                    </div>
                    <div className={`${styles.spVariance} ${r.variancePct >= 0 ? styles.spVarGood : styles.spVarBad}`}>
                      {r.variancePct >= 0 ? "+" : ""}{r.variancePct.toFixed(1)}%
                    </div>
                  </button>
                  {isOpen && <SectionTaskBreakdown tasks={r.tasks} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function BarRow({ name, pct, maxPct, tone }: { name: string; pct: number; maxPct: number; tone: "planned" | "actual" }) {
  const width = maxPct > 0 ? Math.max(0, Math.min(100, (pct / maxPct) * 100)) : 0;
  return (
    <div className={styles.barRow}>
      <span className={styles.barLbl}>{name}</span>
      <div className={styles.barTrack}>
        <div className={`${styles.barFill} ${tone === "planned" ? styles.barFillPlanned : styles.barFillActual}`} style={{ width: `${width}%` }} />
      </div>
      <span className={styles.barVal}>{pct.toFixed(2)}%</span>
    </div>
  );
}

function SectionTaskBreakdown({ tasks }: { tasks: SectionProgressRow["tasks"] }) {
  return (
    <div className={styles.spBreakdown}>
      <TaskBucket
        title="Delayed · still open past baseline"
        tone="bad"
        rows={tasks.delayedOpen}
        valueCol="Days behind"
        valueFmt={(d) => `+${d}d`}
      />
      <TaskBucket
        title="Closed late · completed after baseline"
        tone="warn"
        rows={tasks.closedLate}
        valueCol="Days late"
        valueFmt={(d) => `+${d}d`}
      />
      <TaskBucket
        title="Closed early · completed before baseline"
        tone="good"
        rows={tasks.closedEarly}
        valueCol="Days early"
        valueFmt={(d) => `${d}d`}
      />
      <TaskBucket
        title="Closed off-plan · done before baseline was due"
        tone="good"
        rows={tasks.closedOffPlan}
        valueCol="Days early"
        valueFmt={(d) => `${d}d`}
      />
    </div>
  );
}

function TaskBucket({
  title,
  tone,
  rows,
  valueCol,
  valueFmt,
}: {
  title: string;
  tone: "bad" | "warn" | "good";
  rows: SectionProgressRow["tasks"]["delayedOpen"];
  valueCol: string;
  valueFmt: (d: number) => string;
}) {
  const toneCls = tone === "bad" ? styles.spBkBad : tone === "warn" ? styles.spBkWarn : styles.spBkGood;
  return (
    <div className={styles.spBucket}>
      <div className={`${styles.spBucketHd} ${toneCls}`}>
        <span>{title}</span>
        <span className={styles.spBucketCount}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.spBucketEmpty}>Nothing here.</div>
      ) : (
        <table className={styles.spTaskTbl}>
          <thead>
            <tr>
              <th>Villa</th>
              <th>Block</th>
              <th className={styles.tRight}>{valueCol}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              <tr key={`${r.villaNumber}-${i}`}>
                <td className={styles.spTaskVilla}>{r.villaLabel}</td>
                <td>Block {r.blockCode}</td>
                <td className={styles.tRight}>{valueFmt(Math.abs(r.daysDiff))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 20 && <div className={styles.spBucketMore}>+ {rows.length - 20} more</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 - Villa-wise physical progress table
// ---------------------------------------------------------------------------

type VillaSortKey = "villaLabel" | "blockCode" | "currentSection" | "pctComplete" | "slipDays" | "status";
type SortDir = "asc" | "desc";

function VillaProgressCard({ projectId, rows }: { projectId: string; rows: VillaProgressRow[] }) {
  const [sortKey, setSortKey] = useState<VillaSortKey>("blockCode");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const getVal = (r: VillaProgressRow): string | number => {
      switch (sortKey) {
        case "villaLabel":     return r.villaNumber;
        case "blockCode":      return r.blockCode;
        case "currentSection": return r.currentSectionOrder ?? 999;
        case "pctComplete":    return r.pctComplete;
        case "slipDays":       return r.slipDays;
        case "status":         return statusRank(r.status);
      }
    };
    return [...rows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.villaNumber - b.villaNumber;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: VillaSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Physical Progress · villa-wise</h3>
        <span className={styles.meta}>one row per villa · click drill-in from Dashboard for details</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No villas in scope yet.</div>
        ) : (
          <div className={styles.vpTblWrap}>
            <table className={styles.vpTbl}>
              <thead>
                <tr>
                  <SortableTh label="Villa"           active={sortKey === "villaLabel"}     dir={sortDir} onClick={() => toggleSort("villaLabel")} />
                  <SortableTh label="Block"           active={sortKey === "blockCode"}      dir={sortDir} onClick={() => toggleSort("blockCode")} />
                  <SortableTh label="Current section" active={sortKey === "currentSection"} dir={sortDir} onClick={() => toggleSort("currentSection")} />
                  <SortableTh label="% complete"      active={sortKey === "pctComplete"}    dir={sortDir} onClick={() => toggleSort("pctComplete")} align="right" />
                  <SortableTh label="Slip"            active={sortKey === "slipDays"}       dir={sortDir} onClick={() => toggleSort("slipDays")} align="right" />
                  <SortableTh label="Status"          active={sortKey === "status"}         dir={sortDir} onClick={() => toggleSort("status")} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.villaId}>
                    <td>
                      <Link href={`?vn=${r.villaNumber}`} scroll={false} className={styles.vpVillaLink}>
                        {r.villaLabel}
                        {r.villaType && <span className={styles.vpVillaType}>{r.villaType}</span>}
                      </Link>
                    </td>
                    <td className={styles.vpBlockCell}>Block {r.blockCode}</td>
                    <td>{r.currentSectionName ?? <span className={styles.vpMuted}>Not started</span>}</td>
                    <td className={styles.vpNum}>
                      <div className={styles.vpPctWrap}>
                        <div className={styles.vpPctTrack}>
                          <div
                            className={`${styles.vpPctFill} ${r.status === "critical" ? styles.vpPctBad : r.status === "warning" ? styles.vpPctWarn : styles.vpPctGood}`}
                            style={{ width: `${Math.max(0, Math.min(100, r.pctComplete))}%` }}
                          />
                        </div>
                        <span className={styles.vpPctVal}>{r.pctComplete}%</span>
                      </div>
                    </td>
                    <td className={`${styles.vpNum} ${r.slipDays > 15 ? styles.vpSlipBad : r.slipDays > 7 ? styles.vpSlipWarn : styles.vpSlipZero}`}>
                      {r.slipDays === 0 ? "0d" : `+${r.slipDays}d`}
                    </td>
                    <td className={styles.vpStatusCell}>
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function statusRank(s: VillaProgressRow["status"]): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : s === "healthy" ? 2 : 3;
}

function StatusPill({ status }: { status: VillaProgressRow["status"] }) {
  const config = {
    critical:    { label: "Critical",    cls: styles.pillBad },
    warning:     { label: "Warning",     cls: styles.pillWarn },
    healthy:     { label: "On track",    cls: styles.pillGood },
    "not-started": { label: "Not started", cls: styles.pillMuted },
  }[status];
  return <span className={`${styles.pill} ${config.cls}`}>{config.label}</span>;
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <th className={align === "right" ? styles.thRight : ""}>
      <button type="button" onClick={onClick} className={`${styles.thBtn} ${active ? styles.thBtnActive : ""}`}>
        {label}
        <ArrowUpDown size={11} className={active ? styles.thIconActive : styles.thIcon} />
        {active && <span className={styles.thDir}>{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// §3 - Filter by Section
//
// The old "Interactive Drawing" card bundled a master-plan image upload
// with a section filter. The drawing itself was never clickable (per the
// old hint), so on 2026-11-04 Vandana asked to drop the image column and
// keep only the filter + per-status villa chips. That is this card.
// ---------------------------------------------------------------------------

function SectionFilterCard({
  projectId,
  data,
}: {
  projectId: string;
  data: InteractiveDrawingData;
}) {
  const [selectedSectionCode, setSelectedSectionCode] = useState<string | null>(null);

  const sectionIndex = useMemo(() => {
    if (!selectedSectionCode) return null;
    const i = data.sections.findIndex((s) => s.code === selectedSectionCode);
    return i === -1 ? null : i;
  }, [selectedSectionCode, data.sections]);

  const summary = useMemo(() => {
    const counts: Record<VillaSectionStatus, number> = { completed: 0, ongoing: 0, delayed: 0, "not-started": 0 };
    const villasByStatus: Record<VillaSectionStatus, Array<{ villaNumber: number; villaLabel: string; blockCode: string; slipDays: number }>> = {
      completed: [], ongoing: [], delayed: [], "not-started": [],
    };
    if (sectionIndex == null) {
      // Overall: worst status per villa across every section.
      for (const v of data.villas) {
        let worst: VillaSectionStatus = "not-started";
        let worstSlip = 0;
        for (const c of v.cells) {
          if (c.status === "delayed") worst = "delayed";
          else if (c.status === "ongoing" && worst !== "delayed") worst = "ongoing";
          else if (c.status === "completed" && worst === "not-started") worst = "completed";
          if (c.slipDays > worstSlip) worstSlip = c.slipDays;
        }
        counts[worst]++;
        villasByStatus[worst].push({ villaNumber: v.villaNumber, villaLabel: v.villaLabel, blockCode: v.blockCode, slipDays: worstSlip });
      }
    } else {
      for (const v of data.villas) {
        const cell = v.cells[sectionIndex];
        counts[cell.status]++;
        villasByStatus[cell.status].push({ villaNumber: v.villaNumber, villaLabel: v.villaLabel, blockCode: v.blockCode, slipDays: cell.slipDays });
      }
    }
    return { counts, villasByStatus };
  }, [sectionIndex, data.villas]);

  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Filter by Section</h3>
        <span className={styles.meta}>
          {selectedSectionCode
            ? `filtered by ${data.sections.find((s) => s.code === selectedSectionCode)?.name}`
            : "overall villa status across every section"}
        </span>
      </div>
      <div className={styles.cardBd}>
        <div className={styles.idSummary}>
          <SummaryTile label="Completed"   count={summary.counts.completed}      tone="good" />
          <SummaryTile label="Ongoing"     count={summary.counts.ongoing}        tone="warn" />
          <SummaryTile label="Delayed"     count={summary.counts.delayed}        tone="bad" />
          <SummaryTile label="Not started" count={summary.counts["not-started"]} tone="muted" />
        </div>

        <div className={styles.idFilterHd}>Section</div>
        <div className={styles.idChipRow}>
          <button
            type="button"
            className={`${styles.idChip} ${selectedSectionCode === null ? styles.idChipOn : ""}`}
            onClick={() => setSelectedSectionCode(null)}
          >
            Overall
          </button>
          {data.sections.map((s) => (
            <button
              key={s.code}
              type="button"
              className={`${styles.idChip} ${selectedSectionCode === s.code ? styles.idChipOn : ""}`}
              onClick={() => setSelectedSectionCode(s.code)}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className={styles.idVillaLists}>
          {(["delayed", "ongoing", "completed", "not-started"] as VillaSectionStatus[]).map((status) => {
            const list = summary.villasByStatus[status];
            if (list.length === 0) return null;
            return (
              <div key={status} className={styles.idVillaGroup}>
                <div className={`${styles.idVillaGroupHd} ${styles[`idVg_${status}` as keyof typeof styles] ?? ""}`}>
                  <span>{statusLabel(status)}</span>
                  <span className={styles.idVillaGroupCount}>{list.length}</span>
                </div>
                <div className={styles.idVillaChips}>
                  {list.sort((a, b) => b.slipDays - a.slipDays).map((v) => (
                    <Link
                      key={v.villaNumber}
                      href={`?vn=${v.villaNumber}`}
                      scroll={false}
                      className={`${styles.idVillaChip} ${styles[`idVc_${status}` as keyof typeof styles] ?? ""}`}
                    >
                      V{v.villaNumber}
                      {v.slipDays > 0 && <span className={styles.idVillaChipSlip}>+{v.slipDays}d</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function statusLabel(s: VillaSectionStatus): string {
  return s === "completed" ? "Completed"
       : s === "ongoing"   ? "Ongoing"
       : s === "delayed"   ? "Delayed"
       :                     "Not started";
}

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: "good" | "warn" | "bad" | "muted" }) {
  const cls = tone === "good" ? styles.stGood : tone === "warn" ? styles.stWarn : tone === "bad" ? styles.stBad : styles.stMuted;
  return (
    <div className={`${styles.summaryTile} ${cls}`}>
      <div className={styles.stCount}>{count}</div>
      <div className={styles.stLbl}>{label}</div>
    </div>
  );
}
