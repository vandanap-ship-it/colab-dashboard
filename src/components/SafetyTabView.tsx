"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./safety-tab.module.css";
import type { SafetyBundle } from "@/lib/safetyServer";
import { SAFETY_CATEGORIES } from "@/lib/safetyCategories";

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
  const [submissionsWindow, setSubmissionsWindow] = useState<"7d" | "weekly" | "monthly">("7d");

  const submissionsData = useMemo(() => {
    if (submissionsWindow === "7d") return bundle.submissionsLast7Days;
    if (submissionsWindow === "weekly") return bundle.submissionsLast4Weeks;
    return bundle.submissionsLast6Months;
  }, [submissionsWindow, bundle]);

  return (
    <div className={styles.wrap}>
      <OverviewCard overview={bundle.overview} />
      <IncidentCategoriesCard categories={bundle.categories} />
      <ComplianceMatrixCard rows={bundle.compliance} />
      <SafetyDetailsCard inductions={bundle.inductions} />
      <PermitsCard permits={bundle.permits} projectId={projectId} />
      {registers.map((r) => (
        <RegisterCard key={r.code} register={r} projectId={projectId} />
      ))}
      <SubmissionsCard
        data={submissionsData}
        window={submissionsWindow}
        onChange={setSubmissionsWindow}
      />
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
  return (
    <div id="inductions-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Inductions · all rows
        <span className={styles.cardMetaSmall}>{rows.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
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
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.displayId}</td>
                    <td>{fmtShortDate(r.inductionDate)}</td>
                    <td>{r.workerName}</td>
                    <td>{r.trade}</td>
                    <td>{r.contractorName ?? "-"}</td>
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
  return (
    <div id="hse-checklist-list" className={styles.card}>
      <div className={styles.cardHd}>
        HSE Checklists · all rows
        <span className={styles.cardMetaSmall}>{rows.length} rows · includes Colab-imported checklists</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
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
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.createdAt)}</td>
                    <td className={styles.listDesc}>{r.title}</td>
                    <td>{r.wbsName ?? "-"}</td>
                    <td>{r.contractorName ?? "-"}</td>
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
  return (
    <div id="permits-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Permits · all rows
        <span className={styles.cardMetaSmall}>{rows.length} rows · Hot Work, Night Work, De-shuttering</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No safety permits raised yet.</div>
        ) : (
          <div className={styles.listTblWrap}>
            <table className={styles.listTbl}>
              <thead>
                <tr>
                  <th>Work date</th><th>Type</th><th>Title</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.workDate)}</td>
                    <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className={styles.listDesc}>{r.title}</td>
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
  return (
    <div id="observations-list" className={styles.card}>
      <div className={styles.cardHd}>
        Safety Observations · all rows
        <span className={styles.cardMetaSmall}>{rows.length} rows · newest first</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
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
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtShortDate(r.createdAt)}</td>
                    <td>{r.category ?? "-"}</td>
                    <td>{r.severity ?? "-"}</td>
                    <td>{r.status}</td>
                    <td>{r.contractorName ?? "-"}</td>
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
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Safety Overview</div>
      <div className={styles.ovGrid}>
        <a href="#inductions-list" className={`${styles.ovTile} ${styles.ovBig} ${styles.ovLink}`}>
          <div className={styles.ovVal}>{overview.totalInductions.toLocaleString("en-IN")}</div>
          <div className={styles.ovLbl}>Safety Inductions</div>
          <div className={styles.ovSub}>
            {overview.inductionsApproved} approved · {overview.inductionsPending} pending · {overview.inductionsRejected} rejected
          </div>
        </a>
        <a href="#hse-checklist-list" className={`${styles.ovTile} ${styles.ovLink}`}>
          <div className={styles.ovVal}>{overview.totalHseChecklists.toLocaleString("en-IN")}</div>
          <div className={styles.ovLbl}>HSE Checklists</div>
          <div className={styles.ovSub}>
            {overview.hseChecklistsPassed} passed · {overview.hseChecklistsPending} pending review
          </div>
        </a>
        <a href="#permits-list" className={`${styles.ovTile} ${styles.ovLink}`}>
          <div className={styles.ovVal}>{overview.totalSafetyPermits.toLocaleString("en-IN")}</div>
          <div className={styles.ovLbl}>Safety Permits</div>
          <div className={styles.ovSub}>
            {overview.permitsApproved} approved · {overview.permitsPending} pending · {overview.permitsClosedOrRejected} closed or rejected
          </div>
        </a>
        <a href="#observations-list" className={`${styles.ovTile} ${styles.ovLink}`}>
          <div className={styles.ovVal}>{overview.totalSafetyObservations.toLocaleString("en-IN")}</div>
          <div className={styles.ovLbl}>Safety Observations</div>
          <div className={styles.ovSub}>raised to date</div>
        </a>
        <div className={styles.ovTile}>
          <div className={styles.ovVal}>{overview.safeManHours.toLocaleString()}</div>
          <div className={styles.ovLbl}>Safe man-hours</div>
          <div className={styles.ovSub}>{overview.safeSincePreset} · 8 hours per worker day</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 Incident Categories
// ---------------------------------------------------------------------------

function IncidentCategoriesCard({ categories }: { categories: SafetyBundle["categories"] }) {
  const total = categories.reduce((n, c) => n + c.count, 0);
  const nonZero = categories.filter((c) => c.count > 0);
  const withZeros = categories.filter((c) => c.count === 0);
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Incident Categories
        <span className={styles.cardMeta}>{total} incident{total === 1 ? "" : "s"} total · {categories.length} categories</span>
      </div>
      <div className={styles.icBody}>
        {total === 0 ? (
          <div className={styles.empty}>No incidents recorded in any category. Excellent.</div>
        ) : (
          <div className={styles.icGrid}>
            {nonZero.map((c) => (
              <IncidentTile key={c.code} row={c} isActive />
            ))}
          </div>
        )}
        {withZeros.length > 0 && (
          <>
            <div className={styles.icSubHd}>Categories with no incidents ({withZeros.length})</div>
            <div className={styles.icGridSmall}>
              {withZeros.map((c) => (
                <IncidentTile key={c.code} row={c} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IncidentTile({ row, isActive }: { row: SafetyBundle["categories"][number]; isActive?: boolean }) {
  const meta = SAFETY_CATEGORIES.find((c) => c.code === row.code);
  return (
    <div className={`${styles.icTile} ${isActive ? styles.icTileActive : styles.icTileMuted}`} title={meta?.description ?? ""}>
      <div className={styles.icCount}>{row.count}</div>
      <div className={styles.icLbl}>{row.label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §3 Contractor Inspection & Compliance Matrix
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

function SafetyDetailsCard({ inductions }: { inductions: SafetyBundle["inductions"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Safety Details
        <span className={styles.cardMeta}>induction status</span>
      </div>
      <div className={styles.sdGrid}>
        <SdTile label="Total submitted" value={inductions.totalSubmitted} tone="neutral" />
        <SdTile label="Approved" value={inductions.approved} tone="good" />
        <SdTile label="Pending" value={inductions.pending} tone="warn" />
        <SdTile label="Rejected" value={inductions.rejected} tone="bad" />
      </div>
      {inductions.totalSubmitted === 0 && (
        <div className={styles.sdNote}>
          Induction submissions module not yet integrated — this will populate as
          the labour induction flow ships.
        </div>
      )}
      {inductions.perContractor.length > 0 && inductions.totalSubmitted > 0 && (
        <>
          <div className={styles.sdSubHd}>Induction compliance % per contractor</div>
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
              {permits.permits.slice(0, 5).map((p) => (
                <div key={p.id} className={`${styles.permitRow} ${styles[`permitStatus_${p.status}` as keyof typeof styles] ?? ""}`}>
                  <div>
                    <div className={styles.permitName}>{p.name}</div>
                    <div className={styles.permitNumber}>{TYPE_LABELS[p.category] ?? p.category}</div>
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
              ))}
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

// ---------------------------------------------------------------------------
// §6 Labour Induction Submissions (placeholder trend)
// ---------------------------------------------------------------------------

function SubmissionsCard({
  data,
  window,
  onChange,
}: {
  data: SafetyBundle["submissionsLast7Days"];
  window: "7d" | "weekly" | "monthly";
  onChange: (v: "7d" | "weekly" | "monthly") => void;
}) {
  const total = data.reduce((n, p) => n + p.count, 0);
  const max = Math.max(1, ...data.map((p) => p.count));
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Labour Induction Submissions
        <div className={styles.subToggle}>
          <button
            type="button"
            className={`${styles.subToggleBtn} ${window === "7d" ? styles.subToggleOn : ""}`}
            onClick={() => onChange("7d")}
          >7 days</button>
          <button
            type="button"
            className={`${styles.subToggleBtn} ${window === "weekly" ? styles.subToggleOn : ""}`}
            onClick={() => onChange("weekly")}
          >Weekly</button>
          <button
            type="button"
            className={`${styles.subToggleBtn} ${window === "monthly" ? styles.subToggleOn : ""}`}
            onClick={() => onChange("monthly")}
          >Monthly</button>
        </div>
      </div>
      <div className={styles.cardBd}>
        {total === 0 ? (
          <div className={styles.empty}>
            No induction submissions in this window. Populates once the labour induction module ships.
          </div>
        ) : (
          <div className={styles.subChart}>
            {data.map((p) => (
              <div key={p.date} className={styles.subBarCell} title={`${p.date}: ${p.count}`}>
                <div className={styles.subBar} style={{ height: `${(p.count / max) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
