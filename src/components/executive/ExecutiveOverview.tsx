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

export interface ExecutiveOverviewProps {
  health: ProjectHealthSummary;
  villas: VillaRollup[];
  blocks: BlockRollup[];
  contractors: ContractorRollup[];
}

// Executive project rollup — the "Overview" tab of the new dashboard IA.
// Props come from the page-level server component: either adapted DB data
// (adaptDashboardBag) or the mock data helpers as a transitional fallback.
export default function ExecutiveOverview({ health: h, villas, blocks, contractors }: ExecutiveOverviewProps) {
  const active = blocks.filter((b) => b.active);
  const projectedDays = daysBetween(h.baselineStart, h.projectedEnd);
  const plannedDays = daysBetween(h.baselineStart, h.baselineEnd);
  const plannedPct = (plannedDays / projectedDays) * 100;
  const overshootPct = 100 - plannedPct;

  return (
    <div className={styles.wrap}>
      {/* Scope strip */}
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

      {/* Health Snapshot */}
      <div className={`${styles.card} ${styles.hs}`}>
        <div className={styles.hsHd}>
          <h3>
            <span className={styles.viewPill}>Block wise</span>
            <span>Overall Project Health Snapshot</span>
          </h3>
          <span className={styles.meta}>
            As of {fmtDate(h.asOf)} · Phase 1 · Contractor: Abraham Thomas
          </span>
        </div>

        <div className={styles.hsGrid}>
          {/* Left cell — Physical progress + timeline */}
          <div className={styles.hsCell}>
            <div className={styles.ptCmp}>
              <div className={styles.ptProgress}>
                <div className={styles.ptSecHd}>Physical Progress</div>
                <div className={styles.ptProgressBody}>
                  <div className={styles.ptBig}>
                    <div className={styles.num}>
                      {h.achievedPct}
                      <span className={styles.pct}>%</span>
                    </div>
                    <div className={styles.lb}>Achieved</div>
                  </div>
                  <div className={styles.ptBarList}>
                    <BarRow name="Planned" pct={h.plannedPct} kind="planned" />
                    <BarRow name="Achieved" pct={h.achievedPct} kind="achieved" />
                  </div>
                </div>
              </div>

              <div className={styles.ptTimeline}>
                <div className={styles.ptSecHd}>Timeline</div>
                <TimelineRow
                  name="Overall"
                  plannedStart={h.baselineStart}
                  plannedEnd={h.baselineEnd}
                  projectedEnd={h.projectedEnd}
                  slipDays={h.totalDelayDays}
                  plannedPct={plannedPct}
                  overshootPct={overshootPct}
                />
                {active.slice(0, 3).map((b) => {
                  const bpDays = plannedDays; // simplification for placeholder
                  const bSlipPct = (b.slipDays / (bpDays + b.slipDays)) * 100;
                  return (
                    <TimelineRow
                      key={b.code}
                      name={`Block ${b.code}`}
                      plannedStart={h.baselineStart}
                      plannedEnd={h.baselineEnd}
                      projectedEnd={new Date(h.baselineEnd.getTime() + b.slipDays * 86400000)}
                      slipDays={b.slipDays}
                      plannedPct={100 - bSlipPct}
                      overshootPct={bSlipPct}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Middle — Schedule summary rows */}
          <div className={styles.hsCell}>
            <div className={styles.hsLbl}>Schedule Summary</div>
            <div className={styles.ssRows}>
              <ScheduleRow label="Planned Start" value={fmtDate(h.baselineStart)} />
              <ScheduleRow label="Planned Finish" value={fmtDate(h.baselineEnd)} />
              <ScheduleRow
                label="Projected Finish"
                value={fmtDate(h.projectedEnd)}
                variant="projected"
              />
              <ScheduleRow label="Planned Duration" value={`${plannedDays} days`} />
              <ScheduleRow label="Projected Duration" value={`${plannedDays + h.totalDelayDays} days`} />
              <ScheduleRow label="Total Delay" value={`${h.totalDelayDays} days`} variant={h.totalDelayDays > 0 ? "projected" : undefined} />
              <ScheduleRow label="RERA Delay" value={`${h.reraDelayDays} days`} />
              <ScheduleRow
                label="Probability of Timely Completion"
                value={
                  <span className={`${styles.probPill} ${styles[h.probability]}`}>
                    {h.probability === "low" ? "Low" : h.probability === "med" ? "Medium" : "High"}
                  </span>
                }
              />
            </div>
          </div>

          {/* Right — big stats */}
          <div className={styles.hsCell}>
            <div className={styles.hsStats}>
              <div className={styles.hsStat}>
                <div className={`${styles.v} ${styles.bad}`}>{h.totalDelayDays}</div>
                <div className={styles.l}>Days of delay</div>
              </div>
              <div className={styles.hsStat}>
                <div className={`${styles.v} ${styles.warn}`}>{h.hindrances}</div>
                <div className={styles.l}>Active hindrances</div>
              </div>
              <div className={styles.hsStat}>
                <div className={`${styles.v} ${styles.bad}`}>{h.criticalBlocks}</div>
                <div className={styles.l}>Critical blocks</div>
              </div>
            </div>
          </div>
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
    </div>
  );
}

function BarRow({ name, pct, kind }: { name: string; pct: number; kind: "planned" | "achieved" }) {
  const fillClass = kind === "planned" ? styles.fillPlanned : styles.fillAchieved;
  return (
    <div className={styles.ptBarRow}>
      <span className={styles.name}>{name}</span>
      <div className={styles.track}>
        <div className={`${styles.fill} ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.val}>{pct}%</span>
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

function ScheduleRow({
  label,
  value,
  variant,
}: {
  label: string;
  value: React.ReactNode;
  variant?: "projected";
}) {
  return (
    <div className={styles.ssRow}>
      <span className={styles.ssLb}>{label}</span>
      <span className={`${styles.ssVl} ${variant === "projected" ? styles.projected : ""}`}>
        {value}
      </span>
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
              <div key={b.code} className={styles.blockTile}>
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
              </div>
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
                <div key={v.number} className={styles.bucketChip}>
                  V{v.number}
                  <span className={styles.slip}>
                    {v.slipDays > 0 ? `+${v.slipDays}d` : "on-time"}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
