"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./safety-tab.module.css";
import type { SafetyBundle } from "@/lib/safetyServer";
import { SAFETY_CATEGORIES } from "@/lib/safetyCategories";

export interface SafetyTabViewProps {
  projectId: string;
  bundle: SafetyBundle;
}

export default function SafetyTabView({ projectId, bundle }: SafetyTabViewProps) {
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
      <SubmissionsCard
        data={submissionsData}
        window={submissionsWindow}
        onChange={setSubmissionsWindow}
      />
      <p className={styles.footer}>
        Labour induction submissions will populate as the Induction module comes online.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §1 Safety Overview
// ---------------------------------------------------------------------------

function OverviewCard({ overview }: { overview: SafetyBundle["overview"] }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>Safety Overview</div>
      <div className={styles.ovGrid}>
        <div className={`${styles.ovTile} ${styles.ovBig}`}>
          <div className={styles.ovVal}>{overview.daysSinceLastIncident}</div>
          <div className={styles.ovLbl}>Days since last incident</div>
          <div className={styles.ovSub}>
            {overview.lastIncidentDate
              ? "last: " + new Date(overview.lastIncidentDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
              : "no incidents recorded"}
          </div>
        </div>
        <div className={styles.ovTile}>
          <div className={styles.ovVal}>{overview.ltiFreeDays}</div>
          <div className={styles.ovLbl}>LTI-free days</div>
          <div className={styles.ovSub}>{overview.safeSincePreset}</div>
        </div>
        <div className={styles.ovTile}>
          <div className={styles.ovVal}>{overview.safeManHours.toLocaleString()}</div>
          <div className={styles.ovLbl}>Safe man-hours</div>
          <div className={styles.ovSub}>{overview.safeSincePreset} · 8h/day baseline</div>
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
                  <th className={styles.cmNcr}>NCR</th>
                  <th>Avg TAT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.contractorId}>
                    <td className={styles.cmName}>{r.contractorName}</td>
                    <td>{r.inspections.total || "—"}</td>
                    <td className={styles.cmClosed}>{r.inspections.closed || "—"}</td>
                    <td className={styles.cmReview}>{r.inspections.inReview || "—"}</td>
                    <td className={styles.cmObs}>{r.inspections.obs || "—"}</td>
                    <td className={styles.cmNcr}>{r.inspections.ncr || "—"}</td>
                    <td>{r.inspections.avgTatDays == null ? "—" : `${r.inspections.avgTatDays}d`}</td>
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
                  {c.approvedPct == null ? "—" : `${c.approvedPct}%`}
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
  return (
    <div className={styles.card}>
      <div className={styles.cardHd}>
        Active Safety Permits
        <span className={styles.cardMeta}>
          {permits.totalActive} active · {permits.expiringSoon} expiring soon · {permits.expired} expired
        </span>
      </div>
      <div className={styles.cardBd}>
        {permits.permits.length === 0 ? (
          <div className={styles.emptyWithAction}>
            <div className={styles.empty}>No safety permits recorded yet.</div>
            <Link href={`/projects/${projectId}/permits`} className={styles.actionBtn}>
              Manage Permits →
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.permitList}>
              {permits.permits.slice(0, 5).map((p) => (
                <div key={p.id} className={`${styles.permitRow} ${styles[`permitStatus_${p.status}` as keyof typeof styles] ?? ""}`}>
                  <div>
                    <div className={styles.permitName}>{p.name}</div>
                    {p.number && <div className={styles.permitNumber}>#{p.number}</div>}
                  </div>
                  <div className={styles.permitExpiry}>
                    {p.expiryDate
                      ? "expires " + new Date(p.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                      : "no expiry"}
                  </div>
                  <div className={`${styles.permitStatusPill} ${styles[`permitPill_${p.status}` as keyof typeof styles] ?? ""}`}>
                    {p.status.replace("_", " ")}
                  </div>
                </div>
              ))}
            </div>
            <Link href={`/projects/${projectId}/permits`} className={styles.actionBtnFullWidth}>
              View Permit Detail Matrix →
            </Link>
          </>
        )}
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
