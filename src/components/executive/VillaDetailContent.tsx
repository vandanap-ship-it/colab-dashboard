import styles from "./detailDrawer.module.css";
import type { VillaDetail, VillaDetailMilestone } from "@/lib/detailServer";

export default function VillaDetailContent({ villa }: { villa: VillaDetail }) {
  const currentMilestone = villa.currentSection >= 0
    ? villa.milestones.find((m) => m.sectionOrder === villa.currentSection) ?? null
    : null;

  return (
    <>
      {/* Top stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.lb}>Progress</div>
          <div className={styles.vl}>{villa.overallPctComplete}%</div>
          <div className={styles.sub}>weighted mean</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.lb}>Current slip</div>
          <div className={`${styles.vl} ${slipColor(villa.currentSlipDays)}`}>
            {villa.currentSlipDays === 0 ? "—" : `${villa.currentSlipDays}d`}
          </div>
          <div className={styles.sub}>
            {currentMilestone?.sectionName ?? "not started"}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.lb}>Handover slip</div>
          <div className={`${styles.vl} ${slipColor(villa.handoverSlipDays)}`}>
            {villa.handoverSlipDays === 0 ? "on-time" : `${villa.handoverSlipDays}d`}
          </div>
          <div className={styles.sub}>vs baseline</div>
        </div>
      </div>

      {/* Milestone list */}
      <div className={styles.section}>
        <div className={styles.sectionHd}>All 21 milestones</div>
        {villa.milestones.map((m) => (
          <MilestoneRow key={m.sectionCode} milestone={m} />
        ))}
      </div>
    </>
  );
}

function MilestoneRow({ milestone: m }: { milestone: VillaDetailMilestone }) {
  const dotClass = ({
    "done": styles.done,
    "done-late": styles.doneLate,
    "in-progress": styles.inProgress,
    "at-risk": styles.atRisk,
    "not-started": styles.notStarted,
  } as const)[m.status];

  return (
    <div className={styles.msRow}>
      <div className={`${styles.msDot} ${dotClass}`} />
      <div className={styles.msMain}>
        <div className={styles.msName}>{m.sectionName}</div>
        <div className={styles.msDates}>
          <span className={styles.dLabel}>Baseline:</span>{" "}
          {fmtDate(m.baselineStart)} → {fmtDate(m.baselineFinish)}
          {m.actualFinish && (
            <>
              {" · "}
              <span className={styles.dLabel}>Actual:</span>{" "}
              {fmtDate(m.actualFinish)}
            </>
          )}
          {!m.actualFinish && m.projectedFinish && (
            <>
              {" · "}
              <span className={styles.dLabel}>Projected:</span>{" "}
              {fmtDate(m.projectedFinish)}
            </>
          )}
        </div>
      </div>
      <div className={styles.msMeta}>
        <div className={styles.msPct}>{Math.round(m.pctComplete)}%</div>
        {m.slipDays > 0 && (
          <div className={styles.msSlipChip}>+{m.slipDays}d</div>
        )}
      </div>
    </div>
  );
}

function slipColor(slip: number): string {
  if (slip === 0) return styles.good;
  if (slip > 30) return styles.bad;
  return styles.warn;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}
