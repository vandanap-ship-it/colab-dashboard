"use client";

import styles from "./qaqc-tab.module.css";
import type { InspectionRow, IssueRow, QaqcBundle } from "@/lib/qaqcServer";

export interface QaqcTabViewProps {
  projectId: string;
  bundle: QaqcBundle;
}

/**
 * QA/QC tab, pyramid-structured (Vandana 2026-11-04 management-review pass,
 * iteration 4). One governing question per tab: "Is what we built good?"
 * Top number dissects downward:
 *
 *   1. First-pass pass rate  — the single lead metric (big hero)
 *   2. Supporting tiles      — open issues, open NCRs, avg close TAT
 *   3. By contractor         — Contractor Performance Master
 *   4. Photo wall            — the one piece of thin-data content that
 *                              still reads compellingly
 *   5. Row-level detail      — Issues list, Inspections list
 *
 * Removed in this pass (noise cards that competed with the headline):
 *   - Material Inspection Request placeholder (no data yet)
 *   - Defects by Category     (all "Uncategorised" on Amanvana today)
 *   - Latest Day Snapshot     (near-zero every day)
 *   - Last 7 days mini-trend  (dataset too thin to tell a story)
 *   - TAT trend 30-day chart  (same reason; avg sits in the hero now)
 */
export default function QaqcTabView({ projectId, bundle }: QaqcTabViewProps) {
  const openIssues = bundle.issues.obs.new + bundle.issues.obs.inReview;
  const openNcrs = bundle.issues.ncs.new + bundle.issues.ncs.inReview;
  return (
    <div className={styles.wrap}>
      <QaqcHero
        passRate={bundle.wir.successRate}
        totalInspections={bundle.inspectionRows.length}
        passed={bundle.wir.passed}
        inReview={bundle.wir.inReview}
        rejected={bundle.wir.rejected}
        openIssues={openIssues}
        openNcrs={openNcrs}
        avgCloseTatDays={bundle.issues.submissionTATDays}
      />
      <ObservationsBreakdownCard rows={bundle.issueRows} />
      <ContractorPerformanceCard rows={bundle.contractors} />
      <RecentPhotoFeedCard photos={bundle.recentPhotos} />
      <IssuesListCard rows={bundle.issueRows} />
      <InspectionsListCard rows={bundle.inspectionRows} />
      {/* Suppress unused warning */}
      <input type="hidden" value={projectId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pyramid hero: one headline + supporting tiles
// ---------------------------------------------------------------------------

function QaqcHero({
  passRate,
  totalInspections,
  passed,
  inReview,
  rejected,
  openIssues,
  openNcrs,
  avgCloseTatDays,
}: {
  passRate: number | null;
  totalInspections: number;
  passed: number;
  inReview: number;
  rejected: number;
  openIssues: number;
  openNcrs: number;
  avgCloseTatDays: number | null;
}) {
  const passRateTone =
    passRate == null ? "" :
    passRate >= 90 ? styles.heroGood :
    passRate >= 75 ? styles.heroWarn :
    styles.heroBad;
  return (
    <div className={styles.heroCard}>
      <div className={styles.heroMainRow}>
        <div className={styles.heroMain}>
          <div className={styles.heroLbl}>First-pass inspection pass rate</div>
          <div className={`${styles.heroMainVal} ${passRateTone}`}>
            {passRate == null ? "-" : `${passRate}%`}
          </div>
          <div className={styles.heroSub}>
            {passed} passed · {rejected} rejected · {inReview} in review · {totalInspections} inspections submitted
          </div>
        </div>
        <a href="#issues-list" className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Open issues</div>
          <div className={styles.heroSupportVal}>{openIssues}</div>
          <div className={styles.heroSupportSub}>observations · click to see rows</div>
        </a>
        <a href="#issues-list" className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Open NCRs</div>
          <div className={`${styles.heroSupportVal} ${openNcrs > 0 ? styles.heroBad : ""}`}>{openNcrs}</div>
          <div className={styles.heroSupportSub}>critical non-conformance</div>
        </a>
        <div className={styles.heroSupport}>
          <div className={styles.heroSupportLbl}>Avg close TAT</div>
          <div className={styles.heroSupportVal}>
            {avgCloseTatDays == null ? "-" : `${avgCloseTatDays}d`}
          </div>
          <div className={styles.heroSupportSub}>days from open to closed</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observations status breakdown - the design Vandana sketched 2026-11-04:
// OBSERVATIONS · N RAISED, one row per status (Open / In review / Closed),
// each row a bar + share % + absolute count. Clicking a row scrolls down
// to the matching issue rows below.
//
// "Observations" here = every QA/QC Issue on the project, regardless of
// severity. OBS + NCS both fold in because management asks about the
// combined headcount. The data source is the same issueRows the hero
// uses, so the two can't disagree.
// ---------------------------------------------------------------------------

function ObservationsBreakdownCard({ rows }: { rows: IssueRow[] }) {
  // Map DB statuses onto the three buckets management thinks in.
  //   - Open      = OPEN (new/unassigned/in-rework)
  //   - In review = IN_REVIEW, IN_REINSPECTION
  //   - Closed    = RESOLVED, CLOSED, REJECTED
  const buckets = { open: 0, inReview: 0, closed: 0 };
  for (const r of rows) {
    const s = (r.status ?? "").toUpperCase();
    if (s === "OPEN") buckets.open++;
    else if (s === "IN_REVIEW" || s === "IN_REINSPECTION") buckets.inReview++;
    else buckets.closed++; // RESOLVED, CLOSED, REJECTED, unknown all fold here
  }
  const total = rows.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  const bars: Array<{ key: string; label: string; count: number; share: number; tone: "open" | "review" | "closed" }> = [
    { key: "open",    label: "Open",      count: buckets.open,     share: pct(buckets.open),     tone: "open" },
    { key: "review",  label: "In review", count: buckets.inReview, share: pct(buckets.inReview), tone: "review" },
    { key: "closed",  label: "Closed",    count: buckets.closed,   share: pct(buckets.closed),   tone: "closed" },
  ];

  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Observations · {total.toLocaleString("en-IN")} raised
        <span className={styles.cardMeta}>
          every QA/QC observation on the project · click a status to see the rows
        </span>
      </div>
      <div className={styles.cardBd}>
        {total === 0 ? (
          <div className={styles.empty}>No observations raised yet.</div>
        ) : (
          <div className={styles.obsTbl}>
            <div className={`${styles.obsTblRow} ${styles.obsTblHd}`}>
              <div>Status</div>
              <div />
              <div className={styles.obsShareHd}>Share</div>
              <div className={styles.obsCountHd}>Count</div>
            </div>
            {bars.map((b) => (
              <a key={b.key} href="#issues-list" className={styles.obsTblRow}>
                <div className={styles.obsLbl}>{b.label}</div>
                <div className={styles.obsBarWrap}>
                  <div
                    className={`${styles.obsBar} ${
                      b.tone === "open" ? styles.obsBarOpen
                      : b.tone === "review" ? styles.obsBarReview
                      : styles.obsBarClosed
                    }`}
                    style={{ width: `${total === 0 ? 0 : (b.count / total) * 100}%` }}
                  />
                </div>
                <div className={styles.obsShare}>{total === 0 ? "-" : `${b.share}%`}</div>
                <div className={styles.obsCount}>{b.count}</div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contractor Performance Master - dissects the top pass-rate by contractor
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
                {rows.map((r) => {
                  const wirTotal = r.wir.new + r.wir.inReview + r.wir.closed;
                  const issuesTotal = r.issues.new + r.issues.inReview + r.issues.closed;
                  const noData = wirTotal === 0 && issuesTotal === 0;
                  if (noData) {
                    return (
                      <tr key={r.contractorId}>
                        <td className={styles.cpName}>{r.contractorName}</td>
                        <td colSpan={8} className={styles.cpNoData}>
                          Data not updated · nothing logged by this contractor's team yet
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.contractorId}>
                      <td className={styles.cpName}>{r.contractorName}</td>
                      <td>{r.wir.new || "-"}</td>
                      <td>{r.wir.inReview || "-"}</td>
                      <td>{r.wir.closed || "-"}</td>
                      <td>{r.wir.tatDays == null ? "-" : `${r.wir.tatDays}d`}</td>
                      <td>{r.issues.new || "-"}</td>
                      <td>{r.issues.inReview || "-"}</td>
                      <td>{r.issues.closed || "-"}</td>
                      <td>{r.issues.tatDays == null ? "-" : `${r.issues.tatDays}d`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo wall - the one piece of content that reads well with thin data
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
// §10 Issues list (click-through target)
// ---------------------------------------------------------------------------

function IssuesListCard({ rows }: { rows: IssueRow[] }) {
  return (
    <div id="issues-list" className={styles.card}>
      <div className={styles.cardHd}>
        Issues &amp; Defects · all rows
        <span className={styles.cardMeta}>{rows.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No issues raised on this project yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Where</th>
                  <th>Contractor</th>
                  <th>Raised by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.createdAt)}</td>
                    <td>{r.category ?? "-"}</td>
                    <td>{r.severity ?? "-"}</td>
                    <td className={styles.listDesc}>{r.description}</td>
                    <td>{r.wbsName ?? "-"}</td>
                    <td>{r.contractorName ?? "Not tagged"}</td>
                    <td>{r.createdByName}</td>
                    <td>{r.status}</td>
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
// §11 Inspections list (click-through target for WIR tile)
// ---------------------------------------------------------------------------

function InspectionsListCard({ rows }: { rows: InspectionRow[] }) {
  // rows arrive newest-first from the server; reassert here so a UI
  // sort change doesn't silently reorder the management view.
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div id="inspections-list" className={styles.card}>
      <div className={styles.cardHd}>
        QA/QC Inspection submissions · all rows
        <span className={styles.cardMeta}>{sorted.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No QA/QC inspections submitted on this project yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Where</th>
                  <th>Contractor</th>
                  <th>Filled by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.createdAt)}</td>
                    <td className={styles.listDesc}>{r.title}</td>
                    <td>{r.wbsName ?? "-"}</td>
                    <td>{r.contractorName ?? "Not tagged"}</td>
                    <td>{r.filledByName}</td>
                    <td>{r.status}</td>
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

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

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
