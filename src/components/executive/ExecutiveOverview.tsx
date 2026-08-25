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
import type { MilestoneProgressRow, SiteActivityBlockGroup } from "@/lib/dashboardSectionsServer";

export interface ManpowerStrip {
  planned: number;
  actual: number;
  variance: number;
  pctOfPlan: number | null;
  status: "no-plan" | "above" | "on-plan" | "below" | "not-logged";
}

export interface ExecutiveOverviewProps {
  health: ProjectHealthSummary;
  villas: VillaRollup[];
  blocks: BlockRollup[];
  contractors: ContractorRollup[];
  reasonClusters: DelayReasonCluster[];
  manpowerStrip: ManpowerStrip;
  milestoneProgress: MilestoneProgressRow[];
  siteActivity: SiteActivityBlockGroup[];
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
  milestoneProgress,
  siteActivity,
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
      {/* Scope strip — context */}
      <div className={styles.scopeStrip}>
        <div className={`${styles.scopeCell} ${styles.hi}`}>
          <div className={styles.lb}>Total Project</div>
          <div className={styles.vl}>
            {h.totalPlots} <span className={styles.sm}>plots · {h.inScope} in scope · {h.modelVillas} model villas</span>
          </div>
        </div>
        <div className={styles.scopeCell}>
          <div className={styles.lb}>Contractor · Abraham Thomas</div>
          <div className={styles.vl}>
            {h.atVillas} <span className={styles.sm}>villas · {h.atBlocks} blocks</span>
          </div>
        </div>
        <div className={styles.scopeCell}>
          <div className={styles.lb}>Phase 1 · In Execution</div>
          <div className={styles.vl}>
            {h.phase1Villas} <span className={styles.sm}>villas · {h.phase1BlocksActive} blocks active</span>
          </div>
        </div>
        <div className={styles.scopeCell}>
          <div className={styles.lb}>Baseline Window</div>
          <div className={styles.vl}>
            {fmtDate(h.baselineStart)} <span className={styles.sm}>→ {fmtDate(h.baselineEnd)}</span>
          </div>
        </div>
      </div>

      {/* KPI row — 4 headline stats */}
      <div className={styles.kpiRow}>
        <div className={`${styles.kpi} ${h.totalDelayDays > 0 ? styles.bad : styles.good}`}>
          <div className={styles.kpiLbl}>Total Delay</div>
          <div className={`${styles.kpiVal} ${h.totalDelayDays > 0 ? styles.bad : styles.good}`}>
            {h.totalDelayDays}
            <span className={styles.unit}>{h.totalDelayDays === 1 ? "day" : "days"}</span>
          </div>
          <div className={styles.kpiSub}>
            {h.totalDelayDays === 0 ? "No slippage vs baseline" : `Behind ${fmtDate(h.baselineEnd)} baseline`}
          </div>
        </div>

        <div className={`${styles.kpi} ${styles.info}`}>
          <div className={styles.kpiLbl}>Projected Handover</div>
          <div className={styles.kpiVal}>{fmtDate(h.projectedEnd)}</div>
          <div className={styles.kpiSub}>Planned {fmtDate(h.baselineEnd)}</div>
        </div>

        <div className={`${styles.kpi} ${h.hindrances > 0 ? styles.warn : styles.good}`}>
          <div className={styles.kpiLbl}>Active Hindrances</div>
          <div className={`${styles.kpiVal} ${h.hindrances > 0 ? styles.warn : styles.good}`}>
            {h.hindrances}
          </div>
          <div className={styles.kpiSub}>Open blockers on site</div>
        </div>

        <div className={`${styles.kpi} ${h.criticalBlocks > 0 ? styles.bad : styles.good}`}>
          <div className={styles.kpiLbl}>Critical Blocks</div>
          <div className={`${styles.kpiVal} ${h.criticalBlocks > 0 ? styles.bad : styles.good}`}>
            {h.criticalBlocks}
            <span className={styles.unit}>of {activeBlocks.length}</span>
          </div>
          <div className={styles.kpiSub}>Slip &gt; 30 days</div>
        </div>
      </div>

      {/* Health Snapshot */}
      <div className={`${styles.card} ${styles.hs}`}>
        <div className={styles.hsHd}>
          <h3>
            <span className={styles.viewPill}>Block wise</span>
            <span>Overall Project Health Snapshot</span>
            <span className={`${styles.projectHealthPill} ${styles[h.probability]}`}>
              {healthLabel}
            </span>
          </h3>
          <span className={styles.meta}>
            As of {fmtDate(h.asOf)} · Phase 1 · Contractor: Abraham Thomas
          </span>
        </div>

        <div className={styles.hsGrid}>
          {/* LEFT — Schedule Summary in 2-col grid (Planned | Projected) */}
          <div className={styles.hsCell}>
            <div className={styles.hsLbl}>Schedule Summary</div>
            <div className={styles.ssGrid}>
              <div className={styles.ssCol}>
                <div className={styles.ssColHd}>Planned</div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Start</span>
                  <span className={styles.ssVl}>{fmtDate(h.baselineStart)}</span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Finish</span>
                  <span className={styles.ssVl}>{fmtDate(h.baselineEnd)}</span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Duration</span>
                  <span className={styles.ssVl}>{plannedDays} d</span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>RERA delay</span>
                  <span className={styles.ssVl}>{h.reraDelayDays} d</span>
                </div>
              </div>
              <div className={styles.ssCol}>
                <div className={`${styles.ssColHd} ${styles.projected}`}>Projected</div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Start</span>
                  <span className={styles.ssVl}>{fmtDate(h.baselineStart)}</span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Finish</span>
                  <span className={`${styles.ssVl} ${h.totalDelayDays > 0 ? styles.projected : ""}`}>
                    {fmtDate(h.projectedEnd)}
                  </span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Duration</span>
                  <span className={`${styles.ssVl} ${h.totalDelayDays > 0 ? styles.projected : ""}`}>
                    {plannedDays + h.totalDelayDays} d
                  </span>
                </div>
                <div className={styles.ssRow}>
                  <span className={styles.ssLb}>Total delay</span>
                  <span className={`${styles.ssVl} ${h.totalDelayDays > 0 ? styles.projected : ""}`}>
                    {h.totalDelayDays} d
                  </span>
                </div>
              </div>
              <div className={styles.ssProbRow}>
                <span className={styles.lb}>Probability of timely completion</span>
                <span className={`${styles.probPill} ${styles[h.probability]}`}>{probLabel}</span>
              </div>
            </div>
          </div>

          {/* RIGHT — Timeline: two clean bars (Planned + Projected) */}
          <div className={styles.hsCell}>
            <div className={styles.hsLbl}>Timeline</div>
            <div className={styles.ptTimeline}>
              <TimelineRow
                name="Planned"
                plannedStart={h.baselineStart}
                plannedEnd={h.baselineEnd}
                projectedEnd={h.baselineEnd}
                slipDays={0}
                plannedPct={100}
                overshootPct={0}
              />
              <TimelineRow
                name="Projected"
                plannedStart={h.baselineStart}
                plannedEnd={h.baselineEnd}
                projectedEnd={h.projectedEnd}
                slipDays={h.totalDelayDays}
                plannedPct={plannedPct}
                overshootPct={overshootPct}
              />
              <div className={styles.timelineFoot}>
                <div><span className={styles.tfLb}>Villas delayed</span><span className={styles.tfVl}>{villasDelayed} / {activeVillas.length}</span></div>
                <div><span className={styles.tfLb}>Blocks in red</span><span className={styles.tfVl}>{h.criticalBlocks} / {activeBlocks.length}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Manpower strip */}
      <ManpowerStripRow strip={manpowerStrip} />

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
                <span className={styles.vl}>{c.activeVillas || "—"}</span>
              </div>
              <div className={styles.metric}>
                <span className={styles.lb}>Complete</span>
                <span className={styles.vl}>
                  {c.activeVillas > 0 ? `${c.completePct}%` : "—"}
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
                  {c.activeVillas > 0 ? `+${c.avgDelayDays}d` : "—"}
                </span>
              </div>
              <div className={styles.healthPill}>
                {c.health === "tbd"
                  ? "TBD"
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

      {/* Delay Reason Clusters */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Delay Reason Clusters</h3>
          <span className={styles.meta}>
            open hindrances grouped by root cause · site team tags at log-time
          </span>
        </div>
        <div className={styles.cardBd}>
          <DelayReasonList clusters={reasonClusters} />
        </div>
      </div>

      {/* Block Buckets */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Blocks · Green / Orange / Red</h3>
          <span className={styles.meta}>grouped by current delay · click any block to drill in</span>
        </div>
        <div className={styles.cardBd}>
          <BlockBuckets blocks={blocks} />
        </div>
      </div>

      {/* Villa Buckets */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Villas · Green / Orange / Red</h3>
          <span className={styles.meta}>grouped by current delay · click any villa to drill in</span>
        </div>
        <div className={styles.cardBd}>
          <VillaBuckets villas={villas} />
        </div>
      </div>

      {/* Site Activity Highlights */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <h3>Site Activity Highlights</h3>
          <span className={styles.meta}>
            activities logged today · grouped by block, then villa
          </span>
        </div>
        <div className={styles.cardBd}>
          <SiteActivityHighlights groups={siteActivity} />
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
          <strong>{fmtDate(plannedStart)}</strong> → <strong>{fmtDate(plannedEnd)}</strong>
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
      <BlockBucket kind="healthy" title="Healthy" subtitle="≤ 0d slip" blocks={healthy} />
      <BlockBucket kind="warning" title="Warning" subtitle="1–30d slip" blocks={warning} />
      <BlockBucket kind="critical" title="Critical" subtitle="&gt; 30d slip" blocks={critical} />
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
      <VillaBucket kind="healthy" title="Healthy" subtitle="≤ 0d slip" villas={healthy} />
      <VillaBucket kind="warning" title="Warning" subtitle="1–30d slip" villas={warning} />
      <VillaBucket kind="critical" title="Critical" subtitle="&gt; 30d slip" villas={critical} />
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

function ManpowerStripRow({ strip }: { strip: ManpowerStrip }) {
  const statusLabel = (() => {
    switch (strip.status) {
      case "above":      return `+${strip.variance} above plan`;
      case "on-plan":    return "On plan";
      case "below":      return `${strip.variance} below plan`;
      case "not-logged": return "Not logged today";
      case "no-plan":    return "No plan set";
    }
  })();
  const statusClass = (() => {
    switch (strip.status) {
      case "above":      return styles.mpStatusGood;
      case "on-plan":    return styles.mpStatusOk;
      case "below":      return styles.mpStatusBad;
      case "not-logged": return styles.mpStatusWarn;
      case "no-plan":    return styles.mpStatusMuted;
    }
  })();

  return (
    <div className={`${styles.card} ${styles.mpStrip}`}>
      <div className={styles.mpStripBody}>
        <div className={styles.mpMetric}>
          <div className={styles.mpLbl}>Daily Manpower</div>
          <div className={styles.mpMeta}>Today · planned vs actual</div>
        </div>
        <div className={styles.mpFig}>
          <div className={styles.mpFigLbl}>Planned</div>
          <div className={styles.mpFigVl}>{strip.planned}</div>
        </div>
        <div className={styles.mpFig}>
          <div className={styles.mpFigLbl}>Actual</div>
          <div className={`${styles.mpFigVl} ${strip.status === "above" ? styles.mpGood : strip.status === "below" ? styles.mpBad : ""}`}>
            {strip.status === "not-logged" ? "—" : strip.actual}
          </div>
        </div>
        <div className={styles.mpFig}>
          <div className={styles.mpFigLbl}>% of plan</div>
          <div className={`${styles.mpFigVl} ${strip.status === "above" ? styles.mpGood : strip.status === "below" ? styles.mpBad : ""}`}>
            {strip.pctOfPlan == null ? "—" : `${strip.pctOfPlan}%`}
          </div>
        </div>
        <div className={`${styles.mpStatusPill} ${statusClass}`}>{statusLabel}</div>
      </div>
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
              <td className={styles.mpTblNum}>{r.due === 0 ? "—" : r.due}</td>
              <td className={styles.mpTblNum}>{r.due === 0 ? "—" : r.done}</td>
              <td className={styles.mpTblNum}>{r.due === 0 ? "—" : r.pending}</td>
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

function SiteActivityHighlights({ groups }: { groups: SiteActivityBlockGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className={styles.sahEmpty}>
        Nothing logged today. Site activities will appear here as engineers
        submit progress on their phones.
      </div>
    );
  }
  return (
    <div className={styles.sahList}>
      {groups.map((g) => (
        <div key={g.blockCode} className={styles.sahBlockGroup}>
          <div className={styles.sahBlockHd}>
            Block {g.blockCode}
            <span className={styles.sahBlockCount}>
              {g.villas.reduce((n, v) => n + v.activities.length, 0)} activities · {g.villas.length} villas
            </span>
          </div>
          {g.villas.map((v) => (
            <div key={v.villaNumber} className={styles.sahVillaBlock}>
              <div className={styles.sahVillaHd}>
                <Link
                  href={`?vn=${v.villaNumber}`}
                  scroll={false}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {v.villaLabel}
                </Link>
                <span className={styles.sahActCount}>
                  {v.activities.length} {v.activities.length === 1 ? "activity" : "activities"}
                </span>
              </div>
              <div className={styles.sahCardGrid}>
                {v.activities.map((a) => (
                  <SiteActivityCard key={a.progressEntryId} activity={a} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SiteActivityCard({ activity: a }: { activity: import("@/lib/dashboardSectionsServer").SiteActivity }) {
  return (
    <div className={styles.sahCard}>
      {a.photoUrl ? (
        <div className={styles.sahPhotoWrap}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.photoUrl} alt="" className={styles.sahPhoto} />
        </div>
      ) : (
        <div className={styles.sahPhotoStub}>No photo</div>
      )}
      <div className={styles.sahCardBody}>
        <div className={styles.sahEyebrow}>{a.milestoneName}</div>
        <div className={styles.sahActName}>{a.activityName}</div>
        <div className={styles.sahMeta}>
          {a.achievedPct != null && <span className={styles.sahPct}>{Math.round(a.achievedPct)}%</span>}
          {a.overdueDays != null && <span className={styles.sahOverdue}>{a.overdueDays}d overdue</span>}
        </div>
        {a.notes && <div className={styles.sahRemark}>“{a.notes}”</div>}
        {(a.reasonLabel || a.reasonNote) && (
          <div className={styles.sahReason}>
            <span className={styles.sahReasonLbl}>Delay reason:</span>{" "}
            {a.reasonLabel ?? ""}{a.reasonLabel && a.reasonNote ? " · " : ""}
            {a.reasonNote ? <span className={styles.sahReasonNote}>{a.reasonNote}</span> : null}
          </div>
        )}
        <div className={styles.sahFoot}>
          {a.contractorName ?? "—"} · {a.loggedByName} · {fmtTime(a.loggedAt)}
        </div>
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function DelayReasonList({ clusters }: { clusters: DelayReasonCluster[] }) {
  if (clusters.length === 0) {
    return (
      <div className={styles.drEmpty}>
        No open hindrances. Site team logs blockers with a reason tag —
        once any are open, they cluster here by root cause.
      </div>
    );
  }
  const maxCount = Math.max(...clusters.map((c) => c.count), 1);
  return (
    <div className={styles.drList}>
      {clusters.map((c) => (
        <div key={c.code} className={styles.drRow}>
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
      ))}
    </div>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
