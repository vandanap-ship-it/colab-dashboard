"use client";

import { useRouter, useSearchParams } from "next/navigation";
import styles from "./detailDrawer.module.css";
import type { BlockDetail, BlockDetailVilla } from "@/lib/detailServer";

export default function BlockDetailContent({ block }: { block: BlockDetail }) {
  return (
    <>
      {/* Top stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.lb}>Villas</div>
          <div className={styles.vl}>{block.villaCount}</div>
          <div className={styles.sub}>
            {block.villaRecordCount === block.villaCount
              ? `${block.villaCount} villa records`
              : `${block.villaRecordCount} records (grouped)`}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.lb}>Progress</div>
          <div className={styles.vl}>{block.overallPctComplete}%</div>
          <div className={styles.sub}>mean across villas</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.lb}>Handover slip</div>
          <div className={`${styles.vl} ${slipColor(block.handoverSlipDays)}`}>
            {block.handoverSlipDays === 0 ? "on-time" : `${block.handoverSlipDays}d`}
          </div>
          <div className={styles.sub}>worst villa</div>
        </div>
      </div>

      {/* Villa list — clicking any row swaps the drawer to that villa */}
      <div className={styles.section}>
        <div className={styles.sectionHd}>Villas in this block</div>
        {block.villas.map((v) => (
          <VillaRow key={v.villaId} villa={v} />
        ))}
      </div>
    </>
  );
}

/** Row uses client-side navigation to swap ?bd=... for ?vd=... — closes the
 *  block drawer and opens the villa drawer for the clicked villa. */
function VillaRow({ villa: v }: { villa: BlockDetailVilla }) {
  const router = useRouter();
  const search = useSearchParams();

  const onClick = () => {
    const params = new URLSearchParams(search.toString());
    params.delete("bd");
    params.set("vn", String(v.villaNumber));
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.villaRow}
      style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", width: "100%", textAlign: "left" }}
    >
      <div className={styles.villaRowMain}>
        <div className={styles.villaRowName}>{v.villaLabel}</div>
        <div className={styles.villaRowSub}>
          {v.currentSectionName ?? "Not started yet"}
          {v.currentSlipDays > 0 && ` · +${v.currentSlipDays}d current`}
        </div>
      </div>
      <div className={styles.villaRowPct}>{Math.round(v.overallPctComplete)}%</div>
      <div className={`${styles.villaRowStatus} ${statusClass(v.status)}`}>
        {v.status === "not-started"
          ? "Not started"
          : v.status === "healthy"
          ? "On-track"
          : v.status === "warning"
          ? "Warning"
          : "Critical"}
      </div>
    </button>
  );
}

function slipColor(slip: number): string {
  if (slip === 0) return styles.good;
  if (slip > 30) return styles.bad;
  return styles.warn;
}

function statusClass(s: BlockDetailVilla["status"]): string {
  return ({
    "healthy": styles.healthy,
    "warning": styles.warning,
    "critical": styles.critical,
    "not-started": styles.notStarted,
  } as const)[s];
}
