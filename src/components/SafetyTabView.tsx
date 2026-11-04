"use client";

import Link from "next/link";
import styles from "./safety-tab.module.css";
import type { SafetyBundle } from "@/lib/safetyServer";

export type RegisterSummary = {
  code: string;
  name: string;
  live: number;
  overdue: number;
  dueSoon: number;
  pendingDisplayId: string | null;
  lastSignedOff: string | null;
};

export interface SafetyTabViewProps {
  projectId: string;
  bundle: SafetyBundle;
  registers?: RegisterSummary[];
}

export default function SafetyTabView({ projectId, bundle, registers = [] }: SafetyTabViewProps) {
  return (
    <div className={styles.wrap}>
      <OverviewCard overview={bundle.overview} />
      <ComplianceMatrixCard rows={bundle.compliance} />
      <SafetyInductionsCard inductions={bundle.inductions} />
      <PermitsCard permits={bundle.permits} projectId={projectId} />
      {registers.map((r) => (
        <RegisterCard key={r.code} register={r} projectId={projectId} />
      ))}
      <InductionsListCard rows={bundle.inductionRows} />
      <HseChecklistsListCard rows={bundle.hseChecklistRows} />
      <PermitsListCard rows={bundle.permitRows} />
      <ObservationsListCard rows={bundle.observationRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Click-through row lists (added 2026-11-04 management review)
// ---------------------------------------------------------------------------

function InductionsListCard({ rows }: { rows: SafetyBundle["inductionRows"] }) {
  const sorted = [...rows].sort((a, b) => b.inductionDate.localeCompare(a.inductionDate));
  return (
    <div id="inductions-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Inductions · all rows
        <span className={styles.cardMetaSmall}>{sorted.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No inductions submitted yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>ID</th><th>Date</th><th>Worker</th><th>Trade</th><th>Contractor</th><th>Status</th><th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{r.displayId}</td>
                    <td>{fmtShortDate(r.inductionDate)}</td>
                    <td>{r.workerName}</td>
                    <td>{r.trade}</td>
                    <td>{r.contractorName ?? "Not tagged"}</td>
                    <td>{r.status}</td>
                    <td>{fmtShortDate(r.expiryDate)}</td>
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

function HseChecklistsListCard({ rows }: { rows: SafetyBundle["hseChecklistRows"] }) {
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div id="hse-checklist-list" className={styles.card}>
      <div className={styles.cardHd}>
        HSE Checklists · all rows
        <span className={styles.cardMetaSmall}>{sorted.length} rows · newest first · includes Colab-imported checklists</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No HSE checklists submitted yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Date</th><th>Title</th><th>Where</th><th>Contractor</th><th>Filled by</th><th>Status</th>
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

function PermitsListCard({ rows }: { rows: SafetyBundle["permitRows"] }) {
  const TYPE_LABELS: Record<string, string> = {
    HOT_WORK: "Hot Work",
    NIGHT_WORK: "Night Work",
    DESHUTTERING: "De-shuttering",
  };
  const sorted = [...rows].sort((a, b) => b.workDate.localeCompare(a.workDate));
  return (
    <div id="permits-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Permits · all rows
        <span className={styles.cardMetaSmall}>{sorted.length} rows · newest first · Hot Work, Night Work, De-shuttering</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No safety permits raised yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Work date</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>Raised by</th>
                  <th>Approved by</th>
                  <th>Closed by</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.workDate)}</td>
                    <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className={styles.listDesc}>{r.title}</td>
                    <td>{r.requesterName ?? "-"}</td>
                    <td>{r.approverName ?? (r.status === "PENDING" ? "(pending)" : "-")}</td>
                    <td>{r.closerName ?? (r.status === "CLOSED" ? "-" : "")}</td>
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

function ObservationsListCard({ rows }: { rows: SafetyBundle["observationRows"] }) {
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div id="observations-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Observations · all rows
        <span className={styles.cardMetaSmall}>{sorted.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No safety observations recorded.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Date</th><th>Category</th><th>Severity</th><th>Status</th><th>Contractor</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.createdAt)}</td>
                    <td>{r.category ?? "-"}</td>
                    <td>{r.severity ?? "-"}</td>
                    <td>{r.status}</td>
                    <td>{r.contractorName ?? "Not tagged"}</td>
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
// §1 Safety Overview
// ---------------------------------------------------------------------------

function OverviewCard({ overview }: { overview: SafetyBundle["overview"] }) {
  // Pyramid-shaped. One governing question: "Is the site safe?" The lead
  // metric is Safe man-hours (hours of work done without an LTI). The
  // four activity tiles below are the dissection - how we got there.
  // Vandana + boss, 2026-11-04 pyramid pass.
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Safety Overview</div>
      <div className={styles.ovHero}>
        <div className={styles.ovHeroLbl}>Safe man-hours</div>
        <div className={styles.ovHeroVal}>{overview.safeManHours.toLocaleString("en-IN")}</div>
        <div className={styles.ovHeroSub}>
          {overview.safeSincePreset} · counted at 8 hours per worker per day on site
        </div>
      </div>
      <div className={styles.ovSupportGrid}>
        <a href="#inductions-list" className={`${styles.ovSupportTile} ${styles.ovLink}`}>
          <div className={styles.ovSupportLbl}>Safety Inductions</div>
          <div className={styles.ovSupportVal}>{overview.totalInductions.toLocaleString("en-IN")}</div>
          <div className={styles.ovSupportSub}>
            {overview.inductionsApproved} approved · {overview.inductionsPending} pending · {overview.inductionsRejected} rejected
          </div>
        </a>
        <a href="#hse-checklist-list" className={`${styles.ovSupportTile} ${styles.ovLink}`}>
          <div className={styles.ovSupportLbl}>HSE Checklists</div>
          <div className={styles.ovSupportVal}>{overview.totalHseChecklists.toLocaleString("en-IN")}</div>
          <div className={styles.ovSupportSub}>
            {overview.hseChecklistsPassed} passed · {overview.hseChecklistsPending} pending review
          </div>
        </a>
        <a href="#permits-list" className={`${styles.ovSupportTile} ${styles.ovLink}`}>
          <div className={styles.ovSupportLbl}>Safety Permits</div>
          <div className={styles.ovSupportVal}>{overview.totalSafetyPermits.toLocaleString("en-IN")}</div>
          <div className={styles.ovSupportSub}>
            {overview.permitsApproved} approved · {overview.permitsPending} pending · {overview.permitsClosedOrRejected} closed or rejected
          </div>
        </a>
        <a href="#observations-list" className={`${styles.ovSupportTile} ${styles.ovLink}`}>
          <div className={styles.ovSupportLbl}>Safety Observations</div>
          <div className={styles.ovSupportVal}>{overview.totalSafetyObservations.toLocaleString("en-IN")}</div>
          <div className={styles.ovSupportSub}>raised on this project</div>
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 Contractor Inspection & Compliance Matrix
// (Incident Categories was removed 2026-11-04 management review - the site
//  team's category tagging isn't mature enough on Amanvana to show.)
// ---------------------------------------------------------------------------

function ComplianceMatrixCard({ rows }: { rows: SafetyBundle["compliance"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Contractor Inspection & Compliance Matrix</div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No contractors on this project.</div>
        ) : (
          <div className={styles.cmTblWrap}>
            <table className={styles.cmTbl}>
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Total</th>
                  <th>Closed</th>
                  <th>In review</th>
                  <th className={styles.cmObs}>OBS</th>
                  <th>Avg TAT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const noData = r.inspections.total === 0 && r.inspections.obs === 0 && r.inspections.ncr === 0;
                  if (noData) {
                    return (
                      <tr key={r.contractorId}>
                        <td className={styles.cmName}>{r.contractorName}</td>
                        <td colSpan={5} className={styles.cmNoData}>
                          Data not updated · nothing logged by this contractor's team yet
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.contractorId}>
                      <td className={styles.cmName}>{r.contractorName}</td>
                      <td>{r.inspections.total || "-"}</td>
                      <td className={styles.cmClosed}>{r.inspections.closed || "-"}</td>
                      <td className={styles.cmReview}>{r.inspections.inReview || "-"}</td>
                      <td className={styles.cmObs}>{r.inspections.obs || "-"}</td>
                      <td>{r.inspections.avgTatDays == null ? "-" : `${r.inspections.avgTatDays}d`}</td>
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
// §4 Safety Details (inductions)
// ---------------------------------------------------------------------------

function SafetyInductionsCard({ inductions }: { inductions: SafetyBundle["inductions"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Safety Inductions
        <span className={styles.cardMeta}>
          {inductions.totalSubmitted} inductions submitted on site
        </span>
      </div>
      <div className={styles.sdGrid}>
        <SdTile label="Total inductions" value={inductions.totalSubmitted} tone="neutral" />
        <SdTile label="Approved" value={inductions.approved} tone="good" />
        <SdTile label="Pending" value={inductions.pending} tone="warn" />
        <SdTile label="Rejected" value={inductions.rejected} tone="bad" />
      </div>
      {inductions.totalSubmitted === 0 && (
        <div className={styles.sdNote}>
          No inductions submitted on this project yet.
        </div>
      )}
      {inductions.perContractor.length > 0 && inductions.totalSubmitted > 0 && (
        <>
          <div className={styles.sdSubHd}>Induction completion % per contractor</div>
          <div className={styles.sdContractorList}>
            {inductions.perContractor.map((c) => (
              <div key={c.contractorId} className={styles.sdContractorRow}>
                <span className={styles.sdContractorName}>{c.contractorName}</span>
                <span className={styles.sdContractorPct}>
                  {c.approvedPct == null ? "Data not updated" : `${c.approvedPct}%`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SdTile({ label, value, tone }: { label: string; value: number; tone: "good" | "bad" | "warn" | "neutral" }) {
  const cls =
    tone === "good" ? styles.sdGood
  : tone === "bad"  ? styles.sdBad
  : tone === "warn" ? styles.sdWarn
  :                   styles.sdNeutral;
  return (
    <div className={`${styles.sdTile} ${cls}`}>
      <div className={styles.sdVal}>{value}</div>
      <div className={styles.sdLbl}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5 Active Safety Permits
// ---------------------------------------------------------------------------

function PermitsCard({ permits, projectId }: { permits: SafetyBundle["permits"]; projectId: string }) {
  // Type-to-label map for the daily hazard permits surfaced here. Kept in
  // sync with WORK_PERMIT_TYPE_LABELS in src/lib/workPermit.ts; duplicated
  // to avoid pulling a client-side import here.
  const TYPE_LABELS: Record<string, string> = {
    HOT_WORK: "Hot Work",
    NIGHT_WORK: "Night Work",
    DESHUTTERING: "De-shuttering",
  };
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Active Safety Permits
        <span className={styles.cardMeta}>
          {permits.active} approved · {permits.expiringSoon} awaiting approval · {permits.expired} closed / rejected
        </span>
      </div>
      <div className={styles.cardBd}>
        {permits.permits.length === 0 ? (
          <div className={styles.emptyWithAction}>
            <div className={styles.empty}>No safety-relevant work permits raised yet.</div>
            <Link href={`/projects/${projectId}/work-permits`} className={styles.actionBtn}>
              Open Work Permits →
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.permitList}>
              {permits.permits.slice(0, 5).map((p) => {
                const typeLabel = TYPE_LABELS[p.category] ?? p.category;
                // Suppress the type subtitle when the permit name already
                // contains it - otherwise rows read "Hot Work - Villa 14 /
                // Hot Work", which is the duplication Vandana flagged.
                const showType = !p.name.toLowerCase().includes(typeLabel.toLowerCase());
                return (
                  <div key={p.id} className={`${styles.permitRow} ${styles[`permitStatus_${p.status}` as keyof typeof styles] ?? ""}`}>
                    <div>
                      <div className={styles.permitName}>{p.name}</div>
                      {showType && <div className={styles.permitNumber}>{typeLabel}</div>}
                    </div>
                    <div className={styles.permitExpiry}>
                      {p.expiryDate
                        ? "work day " + new Date(p.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                        : ""}
                    </div>
                    <div className={`${styles.permitStatusPill} ${styles[`permitPill_${p.status}` as keyof typeof styles] ?? ""}`}>
                      {p.status.replace("_", " ")}
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href={`/projects/${projectId}/work-permits`} className={styles.actionBtnFullWidth}>
              Open Work Permits →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §5b Registers (fire extinguisher inventory, Oct 2026)
// ---------------------------------------------------------------------------

function RegisterCard({ register: r, projectId }: { register: RegisterSummary; projectId: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        {r.name}
        <span className={styles.cardMeta}>
          {r.live} on site · {r.overdue} overdue · {r.dueSoon} due in 7 days ·{" "}
          {r.pendingDisplayId
            ? `${r.pendingDisplayId} awaiting sign-off`
            : r.lastSignedOff
              ? `signed off ${r.lastSignedOff}`
              : "not signed off yet"}
        </span>
      </div>
      <div className={styles.cardBd}>
        <Link href={`/projects/${projectId}/registers/${r.code}`} className={styles.actionBtnFullWidth}>
          Open register →
        </Link>
      </div>
    </div>
  );
}

// (Labour Induction Submissions trend was removed 2026-11-04 management
// review. Labour Induction and Safety Induction are the same thing in
// Siddhi - the SafetyInduction model. The Safety Inductions card above
// now carries the per-contractor completion breakdown, so a separate
// 7-day / weekly / monthly submission chart isn't needed.)
