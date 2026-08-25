"use client";

import { useMemo } from "react";
import styles from "./qaqc-tab.module.css";
import type { QaqcBundle } from "@/lib/qaqcServer";

export interface QaqcTabViewProps {
  projectId: string;
  bundle: QaqcBundle;
}

export default function QaqcTabView({ projectId, bundle }: QaqcTabViewProps) {
  return (
    <div className={styles.wrap}>
      {/* Top row: WIR + Issues+Defects + Material */}
      <div className={styles.topRow}>
        <WirCard counts={bundle.wir} />
        <IssuesDefectsCard issues={bundle.issues} />
        <MaterialCard counts={bundle.material} />
      </div>

      {/* Latest day + trend + defects by category */}
      <div className={styles.midRow}>
        <DefectsByCategoryCard rows={bundle.defectsByCategory} />
        <div className={styles.midRight}>
          <LatestDayCard snapshot={bundle.latestDay} />
          <TrendCard bundle={bundle.last7Days} />
        </div>
      </div>

      <ContractorPerformanceCard rows={bundle.contractors} />

      <div className={styles.bottomRow}>
        <TatTrendCard points={bundle.tatTrend} />
        <RecentPhotoFeedCard photos={bundle.recentPhotos} />
      </div>

      <p className={styles.footer}>
        Material inspections and material delivery log will appear here once
        those modules are wired.
      </p>

      {/* Suppress unused warning */}
      <input type="hidden" value={projectId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// §1 Work Inspection Request
// ---------------------------------------------------------------------------

function WirCard({ counts }: { counts: QaqcBundle["wir"] }) {
  const successRate = counts.successRate;
  return (
    <div className={`${styles.card} ${styles.cardWir}`}>
      <div className={styles.cardHd}>Work Inspection Request</div>
      <div className={styles.wirBody}>
        <div className={styles.wirBig}>
          <div className={styles.wirBigNum}>{successRate == null ? "—" : `${successRate}%`}</div>
          <div className={styles.wirBigLbl}>Success rate</div>
        </div>
        <div className={styles.wirGrid}>
          <StatCell label="Total inspections" value={counts.total} />
          <StatCell label="Passed" value={counts.passed} tone="good" />
          <StatCell label="Rejected" value={counts.rejected} tone="bad" />
          <StatCell label="In review" value={counts.inReview} tone="warn" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 Issues & Defects
// ---------------------------------------------------------------------------

function IssuesDefectsCard({ issues }: { issues: QaqcBundle["issues"] }) {
  return (
    <div className={`${styles.card} ${styles.cardIssues}`}>
      <div className={styles.cardHd}>Issues & Defects</div>
      <div className={styles.issuesTop}>
        <div>
          <div className={styles.issuesPct}>{issues.completedPct}%</div>
          <div className={styles.issuesPctLbl}>Completed</div>
        </div>
        <div className={styles.issuesTat}>
          <div className={styles.issuesTatCell}>
            <div className={styles.issuesTatVal}>{issues.submissionTATDays == null ? "—" : `${issues.submissionTATDays}d`}</div>
            <div className={styles.issuesTatLbl}>Submission TAT</div>
          </div>
          <div className={styles.issuesTatCell}>
            <div className={styles.issuesTatVal}>{issues.approvalTATDays == null ? "—" : `${issues.approvalTATDays}d`}</div>
            <div className={styles.issuesTatLbl}>Approval TAT</div>
          </div>
        </div>
      </div>
      <BucketRow label={`OBS (${issues.obs.total})`} bucket={issues.obs} />
      <BucketRow label={`NCS (${issues.ncs.total})`} bucket={issues.ncs} />
    </div>
  );
}

function BucketRow({ label, bucket }: { label: string; bucket: QaqcBundle["issues"]["obs"] }) {
  const max = Math.max(1, bucket.new + bucket.inReview + bucket.closed + bucket.rejected);
  return (
    <div className={styles.bucketRow}>
      <div className={styles.bucketLbl}>{label}</div>
      <div className={styles.bucketBar} title={`${bucket.new} new, ${bucket.inReview} in review, ${bucket.closed} closed, ${bucket.rejected} rejected`}>
        {bucket.new > 0    && <div className={`${styles.bucketSeg} ${styles.bucketNew}`}    style={{ flex: bucket.new }}>{bucket.new}</div>}
        {bucket.inReview > 0 && <div className={`${styles.bucketSeg} ${styles.bucketIR}`}   style={{ flex: bucket.inReview }}>{bucket.inReview}</div>}
        {bucket.closed > 0 && <div className={`${styles.bucketSeg} ${styles.bucketCl}`}    style={{ flex: bucket.closed }}>{bucket.closed}</div>}
        {bucket.rejected > 0 && <div className={`${styles.bucketSeg} ${styles.bucketRej}`} style={{ flex: bucket.rejected }}>{bucket.rejected}</div>}
        {max === 1 && <div className={`${styles.bucketSeg} ${styles.bucketEmpty}`} style={{ flex: 1 }}>—</div>}
      </div>
      <div className={styles.bucketLegend}>
        NEW: <b className={styles.bucketNewTxt}>{bucket.new}</b> · IR: <b className={styles.bucketIRTxt}>{bucket.inReview}</b> · CLSD: <b className={styles.bucketClTxt}>{bucket.closed}</b> · REJ: <b className={styles.bucketRejTxt}>{bucket.rejected}</b>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §3 Material Inspection Request (placeholder)
// ---------------------------------------------------------------------------

function MaterialCard({ counts }: { counts: QaqcBundle["material"] }) {
  return (
    <div className={`${styles.card} ${styles.cardMaterial}`}>
      <div className={styles.cardHd}>Material Inspection Request</div>
      <div className={styles.wirBody}>
        <div className={styles.wirBig}>
          <div className={`${styles.wirBigNum} ${styles.mutedNum}`}>—</div>
          <div className={styles.wirBigLbl}>Not yet integrated</div>
        </div>
        <div className={styles.wirGrid}>
          <StatCell label="Total" value={counts.total} tone="muted" />
          <StatCell label="Passed" value={counts.passed} tone="muted" />
          <StatCell label="Rejected" value={counts.rejected} tone="muted" />
          <StatCell label="In review" value={counts.inReview} tone="muted" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §4 Defects by Category
// ---------------------------------------------------------------------------

function DefectsByCategoryCard({ rows }: { rows: QaqcBundle["defectsByCategory"] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Defects by Category</div>
      <div className={styles.dcList}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No defects logged yet.</div>
        ) : (
          rows.map((r) => (
            <div key={r.category} className={styles.dcRow}>
              <div className={styles.dcLbl}>{r.category}</div>
              <div className={styles.dcBarWrap}>
                <div className={styles.dcBar} style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <div className={styles.dcCount}>{r.count}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5 Latest Day
// ---------------------------------------------------------------------------

function LatestDayCard({ snapshot }: { snapshot: QaqcBundle["latestDay"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Latest Day Snapshot</div>
      <div className={styles.latestGrid}>
        <div className={`${styles.latestTile} ${styles.latestBlue}`}>
          <div className={styles.latestVal}>{snapshot.workInspections}</div>
          <div className={styles.latestLbl}>Work Inspections</div>
        </div>
        <div className={`${styles.latestTile} ${styles.latestGreen}`}>
          <div className={styles.latestVal}>{snapshot.materialInspections}</div>
          <div className={styles.latestLbl}>Material Inspections</div>
        </div>
        <div className={`${styles.latestTile} ${styles.latestOrange}`}>
          <div className={styles.latestVal}>{snapshot.nonConformanceReports}</div>
          <div className={styles.latestLbl}>Non-Conformance</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §6 Last 7 days trend
// ---------------------------------------------------------------------------

function TrendCard({ bundle }: { bundle: QaqcBundle["last7Days"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Last 7 Days · MOR</div>
      <div className={styles.trendGrid}>
        <MiniTrend title="Work Inspection" tone="blue" points={bundle.workInspection} />
        <MiniTrend title="Material Inspection" tone="green" points={bundle.materialInspection} />
        <MiniTrend title="Non-Conformance" tone="orange" points={bundle.nonConformance} />
      </div>
    </div>
  );
}

function MiniTrend({ title, tone, points }: { title: string; tone: "blue" | "green" | "orange"; points: { date: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <div className={styles.miniTrend}>
      <div className={styles.miniTitle}>{title}</div>
      <div className={styles.miniBars}>
        {points.map((p) => (
          <div key={p.date} className={styles.miniBarCell} title={`${p.date}: ${p.count}`}>
            <div className={styles.miniBarValue}>{p.count > 0 ? p.count : ""}</div>
            <div
              className={`${styles.miniBar} ${tone === "blue" ? styles.miniBarBlue : tone === "green" ? styles.miniBarGreen : styles.miniBarOrange}`}
              style={{ height: `${(p.count / max) * 100}%` }}
            />
            <div className={styles.miniBarDay}>{p.date.slice(-2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §7 Contractor Performance Master
// ---------------------------------------------------------------------------

function ContractorPerformanceCard({ rows }: { rows: QaqcBundle["contractors"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Contractor Performance Master</div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No contractors on this project.</div>
        ) : (
          <div className={styles.cpTblWrap}>
            <table className={styles.cpTbl}>
              <thead>
                <tr>
                  <th rowSpan={2} className={styles.cpNameCol}>Contractor</th>
                  <th colSpan={4} className={styles.cpGroupWir}>WIR Performance</th>
                  <th colSpan={4} className={styles.cpGroupIssues}>Issues Responsiveness</th>
                </tr>
                <tr>
                  <th>New</th>
                  <th>In review</th>
                  <th>Closed</th>
                  <th>TAT</th>
                  <th>New</th>
                  <th>In review</th>
                  <th>Closed</th>
                  <th>TAT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contractorId}>
                    <td className={styles.cpName}>{r.contractorName}</td>
                    <td>{r.wir.new || "—"}</td>
                    <td>{r.wir.inReview || "—"}</td>
                    <td>{r.wir.closed || "—"}</td>
                    <td>{r.wir.tatDays == null ? "—" : `${r.wir.tatDays}d`}</td>
                    <td>{r.issues.new || "—"}</td>
                    <td>{r.issues.inReview || "—"}</td>
                    <td>{r.issues.closed || "—"}</td>
                    <td>{r.issues.tatDays == null ? "—" : `${r.issues.tatDays}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §8 TAT trend (my addition)
// ---------------------------------------------------------------------------

function TatTrendCard({ points }: { points: QaqcBundle["tatTrend"] }) {
  const values = points.map((p) => p.avgTatDays).filter((v): v is number => v != null);
  const max = values.length > 0 ? Math.max(1, ...values) : 1;

  const [firstAvg, lastAvg] = useMemo(() => {
    const first10 = values.slice(0, 10);
    const last10 = values.slice(-10);
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((n, x) => n + x, 0) / arr.length : null;
    return [avg(first10), avg(last10)];
  }, [values]);

  const trend = firstAvg != null && lastAvg != null
    ? lastAvg < firstAvg ? "improving" : lastAvg > firstAvg ? "worsening" : "flat"
    : null;

  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Inspection TAT · rolling 30 days</div>
      <div className={styles.cardBd}>
        <div className={styles.tatSummary}>
          <span>Avg last 10 days: <b>{lastAvg == null ? "—" : `${lastAvg.toFixed(1)}d`}</b></span>
          {trend && (
            <span className={`${styles.tatTrend} ${trend === "improving" ? styles.tatGood : trend === "worsening" ? styles.tatBad : ""}`}>
              {trend === "improving" ? "↓ improving" : trend === "worsening" ? "↑ worsening" : "= flat"}
            </span>
          )}
        </div>
        <div className={styles.tatChart}>
          {points.map((p) => (
            <div key={p.date} className={styles.tatBarCell} title={`${p.date}: ${p.avgTatDays == null ? "no data" : `${p.avgTatDays}d avg (${p.count})`}`}>
              <div
                className={styles.tatBar}
                style={{
                  height: p.avgTatDays == null ? "3px" : `${(p.avgTatDays / max) * 100}%`,
                  background: p.avgTatDays == null ? "var(--qa-ink-4)" : undefined,
                }}
              />
            </div>
          ))}
        </div>
        <div className={styles.tatFoot}>bars: daily avg turnaround, height ∝ days</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §9 Photo feed (my addition)
// ---------------------------------------------------------------------------

function RecentPhotoFeedCard({ photos }: { photos: QaqcBundle["recentPhotos"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Recent Inspection & Issue Photos</div>
      <div className={styles.cardBd}>
        {photos.length === 0 ? (
          <div className={styles.empty}>No photos in the last 30 days.</div>
        ) : (
          <div className={styles.photoGrid}>
            {photos.map((p) => (
              <div key={p.url} className={styles.photoCell}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className={styles.photoImg} />
                <div className={`${styles.photoBadge} ${p.source === "issue" ? styles.photoBadgeIssue : styles.photoBadgeInspection}`}>
                  {p.source === "issue" ? "Issue" : "Inspection"}
                </div>
                <div className={styles.photoCaption}>
                  <div className={styles.photoLabel}>{p.parentLabel}</div>
                  <div className={styles.photoMeta}>{p.loggedByName} · {fmtRelative(p.loggedAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function StatCell({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" | "muted" }) {
  const cls =
    tone === "good"  ? styles.stGood
  : tone === "bad"   ? styles.stBad
  : tone === "warn"  ? styles.stWarn
  : tone === "muted" ? styles.stMuted
  :                    "";
  return (
    <div className={styles.stCell}>
      <div className={`${styles.stVal} ${cls}`}>{value}</div>
      <div className={styles.stLbl}>{label}</div>
    </div>
  );
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `${Math.max(1, diffHours)}h ago`;
  const days = Math.floor(diffHours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
