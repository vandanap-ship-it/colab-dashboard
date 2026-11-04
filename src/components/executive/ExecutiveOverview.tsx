import Link from "next/link";
import styles from "./executive.module.css";
import {
  SECTIONS,
  blockStatus,
  villaStatus,
  type BlockRollup,
  type ContractorRollup,
  type ProjectHealthSummary,
  type VillaRollup,
} from "@/lib/executiveMockData";
import type { DelayReasonCluster } from "@/lib/delayReasons";
import DelayReasonsCard from "./DelayReasonsCard";
import ManpowerChartCard from "./ManpowerChartCard";
import SiteActivityGallery from "./SiteActivityGallery";
import type { GalleryDateGroup, MilestoneProgressRow } from "@/lib/dashboardSectionsServer";

export interface ManpowerStrip {
  planned: number;
  actual: number;
  variance: number;
  pctOfPlan: number | null;
  status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
}

/** One day on the manpower line chart. ISO date, planned + actual headcount. */
export interface ManpowerDay {
  date: string;
  planned: number;
  actual: number;
}

export interface ExecutiveOverviewProps {
  health: ProjectHealthSummary;
  villas: VillaRollup[];
  blocks: BlockRollup[];
  contractors: ContractorRollup[];
  reasonClusters: DelayReasonCluster[];
  manpowerStrip: ManpowerStrip;
  /** Last 30 days of per-day manpower (planned + actual). The dashboard
   *  renders a line chart with a 7d/30d toggle instead of a single tile. */
  manpowerRange: ManpowerDay[];
  milestoneProgress: MilestoneProgressRow[];
  /** Every uploaded photo on the project, grouped date > block. Replaces
   *  the "today only" highlights, per Shraddha's Sep 17 note. */
  siteActivity: GalleryDateGroup[];
  /** Project display name — used in the Site Activity lightbox's caption
   *  strip and in composed download filenames. Optional so callers that
   *  don't have it fall back to a plain-project label. */
  projectName?: string;
}

// Executive project rollup — the "Dashboard" tab of the new dashboard IA.
// Restructured to match the approved mockup: KPI row at top, health snapshot
// with 2-col grid (Schedule Summary | Timeline), no repeated stats.
export default function ExecutiveOverview({
  health: h,
  villas,
  blocks,
  contractors,
  reasonClusters,
  manpowerStrip,
  manpowerRange,
  milestoneProgress,
  siteActivity,
  projectName,
}: ExecutiveOverviewProps) {
  const activeVillas = villas.filter((v) => v.currentSection >= 0);
  const villasDelayed = activeVillas.filter((v) => v.slipDays > 0).length;
  const projectedDays = daysBetween(h.baselineStart, h.projectedEnd);
  const plannedDays = daysBetween(h.baselineStart, h.baselineEnd);
  const plannedPct = (plannedDays / projectedDays) * 100;
  const overshootPct = 100 - plannedPct;
  const activeBlocks = blocks.filter((b) => b.active);

  const probLabel = h.probability === "low" ? "Low" : h.probability === "med" ? "Medium" : "High";
  const healthLabel =
    h.probability === "high" ? "On track" : h.probability === "med" ? "Watch" : "At risk";

  return (
    <div className={styles.wrap}>
      {/* Scope strip — context. Each cell carries a title tooltip so someone
          hovering the label sees a one-sentence explanation of what it means
          — Shraddha's Sep 9 note: "how do I understand the dashboard? Even
          for me to explain to someone, I'm not sure." Title is a plain-text
          native browser tooltip — no new deps, works on desktop, and screen
          readers pick it up as an accessible name. */}
      <div className={styles.scopeStrip}>
        <div className={`${styles.scopeCell} ${styles.hi}`} title="Total villas in scope on this project. In scope means tracked in the schedule and rolling up into these numbers.">
          <div className={styles.lb}>Total Project</div>
          <div className={styles.vl}>
            {h.inScope}
            <span className={styles.sm}>
              villas in scope
              {h.modelVillas > 0 ? ` · ${h.modelVillas} model villas` : ""}
            </span>
          </div>
        </div>
        <div className={styles.scopeCell} title="Contractor 1, executing Phase 1. Villas and blocks they are responsible for.">
          <div className={styles.lb}>Contractor 1 · Abraham Thomas</div>
          <div className={styles.vl}>
            {h.atVillas} <span className={styles.sm}>villas · {h.atBlocks} blocks</span>
          </div>
        </div>
        <div className={styles.scopeCell} title="Contractor 2 on this project. Villas and blocks allocated to them even if they have not yet mobilised.">
          <div className={styles.lb}>Contractor 2 · Elegant Constructions</div>
          <div className={styles.vl}>
            {h.elegantVillas}
            <span className={styles.sm}>
              villas · {h.elegantBlocks} blocks
            </span>
          </div>
        </div>
        <div className={styles.scopeCell} title="Earliest planned start and latest planned finish across BOTH contractors' schedules. The Total Delay KPI is measured against this window.">
          <div className={styles.lb}>Baseline Window</div>
          <div className={styles.vl}>
            {fmtDate(h.baselineStart)} <span className={styles.sm}>to {fmtDate(h.baselineEnd)}</span>
          </div>
        </div>
      </div>

      {/* KPI row — asymmetric so the number Shraddha (or a director)
          looks at FIRST is visibly biggest. Left headline card carries
          both Total Delay and Projected Handover paired together —
          answers "are we late" and "when do we finish" in one glance.
          Right rail carries Hindrances + Critical Blocks stacked and
          smaller (they're supporting numbers). Daily Manpower absorbed
          in as the fourth cell so today's headcount stays visible on
          the initial fold without its own full-width section. */}
      <div className={styles.kpiRowV2}>
        <div
          className={`${styles.kpiHero} ${h.totalDelayDays > 0 ? styles.bad : styles.neutral}`}
          title="Delay: days behind baseline finish. Handover: when we currently expect to finish based on progress logged so far."
        >
          <div className={styles.kpiHeroLeft}>
            <div className={styles.kpiLbl}>Total Delay</div>
            {/* Zero delay is baseline, not a win — render in ink, not green.
                Green is reserved for actual gains (villas completed, etc).
                Only late (positive delay) turns red. */}
            <div className={`${styles.kpiHeroVal} ${h.totalDelayDays > 0 ? styles.bad : styles.neutral}`}>
              {/* Show absolute value + direction word in the subtitle so a
                  "-30 days" leading minus doesn't read weirdly. */}
              {Math.abs(h.totalDelayDays)}
              <span className={styles.unit}>{Math.abs(h.totalDelayDays) === 1 ? "day" : "days"}</span>
            </div>
            <div className={styles.kpiSub}>
              {h.milestonesAheadOfPlan && h.milestonesAheadOfPlan > 0
                ? `Net of behind and ahead work · ${h.milestonesAheadOfPlan} milestones finished early offset the overdue side`
                : h.totalDelayDays === 0
                  ? `On schedule - nothing overdue, nothing early`
                  : `Mean days overdue across open milestones past baseline`}
            </div>
          </div>
          <div className={styles.kpiHeroDiv} aria-hidden />
          <div className={styles.kpiHeroRight}>
            <div className={styles.kpiLbl}>Projected Handover</div>
            <div className={styles.kpiHeroDate}>{fmtDate(h.projectedEnd)}</div>
            <div className={styles.kpiSub}>Planned {fmtDate(h.baselineEnd)}</div>
          </div>
        </div>

        <div className={styles.kpiRail}>
          <div
            className={`${styles.kpiSmall} ${h.hindrances > 0 ? styles.warn : styles.neutral}`}
            title="Blockers logged by the site team that are still open."
          >
            <div className={styles.kpiLbl}>Active Hindrances</div>
            <div className={`${styles.kpiSmallVal} ${h.hindrances > 0 ? styles.warn : styles.neutral}`}>
              {h.hindrances}
            </div>
            <div className={styles.kpiSub}>Open on site</div>
          </div>
          <div
            className={`${styles.kpiSmall} ${h.criticalBlocks > 0 ? styles.bad : styles.neutral}`}
            title="A block is Critical when its current in-progress stage is more than 15 days past baseline. Zero means no active block has slipped past that threshold today."
          >
            <div className={styles.kpiLbl}>Critical Blocks</div>
            <div className={`${styles.kpiSmallVal} ${h.criticalBlocks > 0 ? styles.bad : styles.neutral}`}>
              {h.criticalBlocks}
              <span className={styles.unit}>/ {activeBlocks.length}</span>
            </div>
            <div className={styles.kpiSub}>Blocks more than 15 days behind on current stage</div>
          </div>
        </div>

        <ManpowerKpiCard strip={manpowerStrip} />
      </div>

      {/* Health Snapshot replaced with a lean one-line timeline strip
          (iteration 4, 2026-11-04 pyramid pass). Total delay numbers
          were previously repeated three times - KPI hero, Schedule
          Summary left, Timeline right. The hero carries the headline;
          this strip only adds planned-start, projected-finish and a
          "Probability of timely completion" readout. */}
      <div className={`${styles.card} ${styles.hs}`}>
        <div className={styles.hsHd}>
          <h3>
            <span>Schedule window</span>
            <span className={`${styles.projectHealthPill} ${styles[h.probability]}`}>
              {healthLabel}
            </span>
          </h3>
          <span className={styles.meta}>
            As of {fmtDate(h.asOf)} · Phase 1 · Contractors: Abraham Thomas, Elegant Constructions
          </span>
        </div>
        <div className={styles.hsStrip}>
          <div className={styles.hsStripCell}>
            <span className={styles.hsStripLb}>Planned finish</span>
            <span className={styles.hsStripVl}>{fmtDate(h.baselineEnd)}</span>
          </div>
          <div className={styles.hsStripCell}>
            <span className={styles.hsStripLb}>Projected finish</span>
            <span className={`${styles.hsStripVl} ${h.totalDelayDays > 0 ? styles.projected : ""}`}>
              {fmtDate(h.projectedEnd)}
            </span>
          </div>
          <div className={styles.hsStripCell}>
            <span className={styles.hsStripLb}>Villas delayed</span>
            <span className={styles.hsStripVl}>{villasDelayed} / {activeVillas.length}</span>
          </div>
          <div className={styles.hsStripCell}>
            <span className={styles.hsStripLb}>Probability of on-time completion</span>
            <span className={`${styles.probPill} ${styles[h.probability]}`}>{probLabel}</span>
          </div>
        </div>
        <div className={styles.ptTimelineLean}>
          <TimelineRow
            name="Schedule"
            plannedStart={h.baselineStart}
            plannedEnd={h.baselineEnd}
            projectedEnd={h.projectedEnd}
            slipDays={h.totalDelayDays}
            plannedPct={plannedPct}
            overshootPct={overshootPct}
          />
        </div>
      </div>

      {/* Where is the delay? — drill-down beneath the Total Delay KPI */}
      <OverdueListCard
        rows={h.overdueList ?? []}
        totalOverdue={(h.milestonesDueByToday ?? 0) - (h.milestonesClosedByToday ?? 0)}
      />

      {/* Daily manpower — 7d / 30d bar chart */}
      <ManpowerChartCard range={manpowerRange} />

      {/* Milestone Progress */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Milestone Progress</h3>
          <span className={styles.meta}>
            line items due by today · closed / pending / status per milestone
          </span>
        </div>
        <div className={styles.cardBd}>
          <MilestoneProgressTable rows={milestoneProgress} />
        </div>
      </div>

      {/* Contractor Scope Health */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Contractor Scope · Health</h3>
          <span className={styles.meta}>
            rated on average delay + risk count · updates as new data arrives
          </span>
        </div>
        <div className={styles.contractorHealth}>
          <div className={`${styles.crRow} ${styles.hdr}`}>
            <div />
            <div>Contractor</div>
            <div>Scope</div>
            <div>Active</div>
            <div>Complete</div>
            <div>Avg delay</div>
            <div>Health</div>
          </div>
          {contractors.map((c) => (
            <div
              key={c.name}
              className={`${styles.crRow} ${styles[c.health] ?? ""}`}
            >
              <div className={styles.stripe} />
              <div className={styles.name}>
                {c.name}
                <span className={styles.nSub}>{c.category}</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.lb}>Villas</span>
                <span className={styles.vl}>{c.scopeVillas}</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.lb}>Active</span>
                <span className={styles.vl}>{c.activeVillas || "not entered"}</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.lb}>Complete</span>
                <span className={styles.vl}>
                  {c.activeVillas > 0 ? `${c.completePct}%` : "not entered"}
                </span>
              </div>
              <div className={styles.metric}>
                <span className={styles.lb}>Avg delay</span>
                <span
                  className={`${styles.vl} ${
                    c.avgDelayDays > 20
                      ? styles.bad
                      : c.avgDelayDays > 7
                      ? styles.warn
                      : c.avgDelayDays > 0
                      ? styles.ok
                      : ""
                  }`}
                >
                  {c.activeVillas > 0 ? `+${c.avgDelayDays}d` : "not entered"}
                </span>
              </div>
              <div className={styles.healthPill}>
                {c.health === "tbd"
                  ? "Data not updated"
                  : c.health === "healthy"
                  ? "On-track"
                  : c.health === "ok"
                  ? "OK"
                  : c.health === "warning"
                  ? "Warning"
                  : "Critical"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delay Reason Clusters — overall only (the By-contractor view was
          dropped 2026-11-04 per Vandana; contractor attribution is covered
          by the Contractor Scope Health table above). */}
      <DelayReasonsCard overall={reasonClusters} />

      {/* Block Buckets */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Blocks · Healthy / Warning / Critical</h3>
          <span className={styles.meta}>grouped by how far the current stage is behind its baseline · click any block to drill in</span>
        </div>
        <div className={styles.cardBd}>
          <BlockBuckets blocks={blocks} />
        </div>
      </div>

      {/* Villa Buckets */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Villas · Healthy / Warning / Critical</h3>
          <span className={styles.meta}>grouped by how far the current stage is behind its baseline · click any villa to drill in</span>
        </div>
        <div className={styles.cardBd}>
          <VillaBuckets villas={villas} />
        </div>
      </div>

      {/* Site Activity Highlights — full project photo gallery,
          newest first. Was "today only" grouped cards; Shraddha
          asked for every image the site team has uploaded so the
          section reads as a live wall of work in progress. */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Site Activity Highlights</h3>
          <span className={styles.meta}>
            every photo uploaded on this project · newest first
          </span>
        </div>
        <div className={styles.cardBd}>
          <SiteActivityGallery
            groups={siteActivity}
            projectName={projectName ?? "Project"}
          />
        </div>
      </div>
    </div>
  );
}

function OverdueListCard({
  rows,
  totalOverdue,
}: {
  rows: NonNullable<ProjectHealthSummary["overdueList"]>;
  totalOverdue: number;
}) {
  if (totalOverdue === 0 || rows.length === 0) return null;
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Where is the delay?</h3>
        <span className={styles.meta}>
          {totalOverdue} milestones past baseline today
          {rows.length < totalOverdue ? ` · showing the top ${rows.length} by days overdue` : ""}
        </span>
      </div>
      <div className={styles.cardBd}>
        <div className={styles.overdueTblWrap}>
          <table className={styles.overdueTbl}>
            <thead>
              <tr>
                <th>Villa</th>
                <th>Block</th>
                <th>Section</th>
                <th>Activity</th>
                <th>Baseline finish</th>
                <th className={styles.tRight}>Days behind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.villaNumber}-${r.sectionName}-${i}`}>
                  <td className={styles.overdueVilla}>{r.villaLabel}</td>
                  <td>Block {r.blockCode}</td>
                  <td>{r.sectionName}</td>
                  <td>{r.activityName ?? "-"}</td>
                  <td>{fmtDate(new Date(r.baselineFinish))}</td>
                  <td className={styles.tRight}>+{r.daysBehind}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TimelineRow({
  name,
  plannedStart,
  plannedEnd,
  projectedEnd,
  slipDays,
  plannedPct,
  overshootPct,
}: {
  name: string;
  plannedStart: Date;
  plannedEnd: Date;
  projectedEnd: Date;
  slipDays: number;
  plannedPct: number;
  overshootPct: number;
}) {
  return (
    <div className={styles.ptTlRow}>
      <div className={styles.ptTlHd}>
        <span className={styles.name}>
          {name}
          {slipDays > 0 && <span className={styles.slipTag}>+{slipDays}d</span>}
        </span>
        <span className={styles.dates}>
          <strong>{fmtDate(plannedStart)}</strong> to <strong>{fmtDate(plannedEnd)}</strong>
          {slipDays > 0 && (
            <> · projected <strong>{fmtDate(projectedEnd)}</strong></>
          )}
        </span>
      </div>
      <div className={styles.ptTlTrack}>
        <div
          className={`${styles.ptTlPlanned} ${slipDays === 0 ? styles.solo : ""}`}
          style={{ width: `${plannedPct}%` }}
        />
        {slipDays > 0 && (
          <div className={styles.ptTlOvershoot} style={{ width: `${overshootPct}%` }} />
        )}
      </div>
    </div>
  );
}

function BlockBuckets({ blocks }: { blocks: BlockRollup[] }) {
  const active = blocks.filter((b) => b.active);
  const healthy = active.filter((b) => blockStatus(b) === "healthy");
  const warning = active.filter((b) => blockStatus(b) === "warning");
  const critical = active.filter((b) => blockStatus(b) === "critical");

  return (
    <div className={styles.bucketGrid}>
      <BlockBucket kind="healthy" title="Healthy" subtitle="on time or ahead" blocks={healthy} />
      <BlockBucket kind="warning" title="Warning" subtitle="1 to 15 days behind" blocks={warning} />
      <BlockBucket kind="critical" title="Critical" subtitle="more than 15 days behind" blocks={critical} />
    </div>
  );
}

function BlockBucket({
  kind,
  title,
  subtitle,
  blocks,
}: {
  kind: "healthy" | "warning" | "critical";
  title: string;
  subtitle: string;
  blocks: BlockRollup[];
}) {
  const totalVillas = blocks.reduce((n, b) => n + b.villas.length, 0);
  return (
    <div className={`${styles.bucket} ${styles[kind]}`}>
      <div className={styles.bucketHd}>
        <div>
          <div className={styles.bTitle}>{title}</div>
          <div className={styles.bSub}>{subtitle}</div>
        </div>
        <div className={styles.bCount}>
          {blocks.length}
          <span className={styles.lb}>Blocks</span>
        </div>
      </div>
      <div className={styles.bucketBd}>
        <div className={styles.bucketSummary}>
          <strong>{totalVillas}</strong> villas across these blocks
        </div>
        {blocks.length === 0 ? (
          <div className={styles.bucketEmpty}>No blocks in this bucket</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blocks.map((b) => (
              <Link
                key={b.code}
                href={`?bd=${encodeURIComponent(b.code)}`}
                scroll={false}
                className={styles.blockTile}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
              >
                <div className={styles.btName}>Block {b.code}</div>
                <div className={styles.btSub}>
                  {b.villas.length} villas · {b.pod} · {SECTIONS[b.currentSection] ?? "Not started"}
                </div>
                <div className={styles.btMetric}>
                  <span className={styles.lb}>Slip</span>
                  <span className={styles.vl}>+{b.slipDays}d</span>
                </div>
                <div className={styles.btMetric}>
                  <span className={styles.lb}>Current milestone</span>
                  <span className={styles.vl}>{b.currentPct}%</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VillaBuckets({ villas }: { villas: VillaRollup[] }) {
  const healthy = villas.filter((v) => villaStatus(v) === "healthy");
  const warning = villas.filter((v) => villaStatus(v) === "warning");
  const critical = villas.filter((v) => villaStatus(v) === "critical");

  return (
    <div className={styles.bucketGrid}>
      <VillaBucket kind="healthy" title="Healthy" subtitle="on time or ahead" villas={healthy} />
      <VillaBucket kind="warning" title="Warning" subtitle="1 to 15 days behind" villas={warning} />
      <VillaBucket kind="critical" title="Critical" subtitle="more than 15 days behind" villas={critical} />
    </div>
  );
}

function VillaBucket({
  kind,
  title,
  subtitle,
  villas,
}: {
  kind: "healthy" | "warning" | "critical";
  title: string;
  subtitle: string;
  villas: VillaRollup[];
}) {
  return (
    <div className={`${styles.bucket} ${styles[kind]}`}>
      <div className={styles.bucketHd}>
        <div>
          <div className={styles.bTitle}>{title}</div>
          <div className={styles.bSub}>{subtitle}</div>
        </div>
        <div className={styles.bCount}>
          {villas.length}
          <span className={styles.lb}>Villas</span>
        </div>
      </div>
      <div className={styles.bucketBd}>
        {villas.length === 0 ? (
          <div className={styles.bucketEmpty}>No villas in this bucket</div>
        ) : (
          <div className={styles.bucketChipWrap}>
            {villas
              .sort((a, b) => b.slipDays - a.slipDays)
              .map((v) => (
                <Link
                  key={v.number}
                  href={`?vn=${v.number}`}
                  scroll={false}
                  className={styles.bucketChip}
                  style={{ textDecoration: "none" }}
                >
                  V{v.number}
                  <span className={styles.slip}>
                    {v.slipDays > 0 ? `+${v.slipDays}d` : "on-time"}
                  </span>
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact KPI-sized manpower card that sits inside the top KPI row
 * (replaces the old full-width ManpowerStripRow). Same underlying
 * ManpowerStrip data — just condensed to fit the small-card slot.
 * Semantics kept identical to the old strip so anyone reading the
 * card sees the same numbers they did before.
 */
function ManpowerKpiCard({ strip }: { strip: ManpowerStrip }) {
  const tone: "good" | "warn" | "info" =
    strip.status === "above"
      ? "good"
      : strip.status === "on-plan"
        ? "good"
        : strip.status === "below"
          ? "warn"
          : strip.status === "not-logged"
            ? "warn"
            : "info";
  const toneClass =
    tone === "good" ? styles.good : tone === "warn" ? styles.warn : styles.info;
  // "no plan" means the planner hasn't set a target for today - which is
  // fine. We still show the actual headcount so the tile carries a real
  // number instead of a dash (Vandana, 2026-11-04 management-review pass).
  const bigNumber =
    strip.status === "not-logged" ? "0" : String(strip.actual);
  const sub =
    strip.status === "no-plan"
      ? `No plan set · ${strip.actual} on site today`
      : strip.status === "not-logged"
        ? `Plan ${strip.planned} · nothing logged yet`
        : strip.status === "above"
          ? `+${strip.variance} above plan of ${strip.planned}`
          : strip.status === "on-plan"
            ? `On plan of ${strip.planned}`
            : `${strip.variance} below plan of ${strip.planned}`;
  return (
    <div
      className={`${styles.kpiSmall} ${styles.kpiManpower} ${toneClass}`}
      title="Today's site headcount. Measured against the planner's target when one is set; otherwise just the actual headcount on site."
    >
      <div className={styles.kpiLbl}>Daily Manpower</div>
      <div className={`${styles.kpiSmallVal} ${toneClass}`}>
        {bigNumber}
        <span className={styles.unit}>workers</span>
      </div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function MilestoneProgressTable({ rows }: { rows: MilestoneProgressRow[] }) {
  if (rows.length === 0) {
    return (
      <div className={styles.mpTblEmpty}>
        No milestones defined yet. Import an MSP schedule to populate.
      </div>
    );
  }
  return (
    <div className={styles.mpTblWrap}>
      <table className={styles.mpTbl}>
        <thead>
          <tr>
            <th className={styles.mpTblName}>Milestone</th>
            <th className={styles.mpTblNum}>Line items due</th>
            <th className={styles.mpTblNum}>Done</th>
            <th className={styles.mpTblNum}>Pending</th>
            <th className={styles.mpTblStatus}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td className={styles.mpTblName}>{r.name}</td>
              <td className={styles.mpTblNum}>{r.due === 0 ? "-" : r.due}</td>
              <td className={styles.mpTblNum}>{r.due === 0 ? "-" : r.done}</td>
              <td className={styles.mpTblNum}>{r.due === 0 ? "-" : r.pending}</td>
              <td className={styles.mpTblStatus}>
                <MilestoneStatusPill row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MilestoneStatusPill({ row }: { row: MilestoneProgressRow }) {
  if (row.status === "not-started") {
    return <span className={`${styles.mpPill} ${styles.mpPillMuted}`}>Not started</span>;
  }
  if (row.status === "all-done") {
    return <span className={`${styles.mpPill} ${styles.mpPillGood}`}>All done</span>;
  }
  return <span className={`${styles.mpPill} ${styles.mpPillBad}`}>{row.pending} pending</span>;
}

// SiteActivityHighlights + SiteActivityCard moved to
// SiteActivityHighlightsClient.tsx — those cards need lightbox state
// (a "use client" concern) and this file stays a Server Component.

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
