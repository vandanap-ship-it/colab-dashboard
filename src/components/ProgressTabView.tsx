"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Trash2, Upload } from "lucide-react";
import styles from "./progress-tab.module.css";
import { useToast } from "./Toast";
import type {
  InteractiveDrawingData,
  SectionProgressRow,
  VillaProgressRow,
  VillaSectionStatus,
} from "@/lib/progressTabServer";

export interface ProgressTabViewProps {
  projectId: string;
  canEditMasterPlan: boolean;
  sectionProgress: SectionProgressRow[];
  villaRows: VillaProgressRow[];
  drawingData: InteractiveDrawingData;
}

export default function ProgressTabView({
  projectId,
  canEditMasterPlan,
  sectionProgress,
  villaRows,
  drawingData,
}: ProgressTabViewProps) {
  return (
    <div className={styles.wrap}>
      <SectionProgressCard rows={sectionProgress} />
      <VillaProgressCard projectId={projectId} rows={villaRows} />
      <InteractiveDrawingCard
        projectId={projectId}
        canEdit={canEditMasterPlan}
        data={drawingData}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// §1 — Planned vs Actual per section
// ---------------------------------------------------------------------------

function SectionProgressCard({ rows }: { rows: SectionProgressRow[] }) {
  const maxPct = Math.max(100, ...rows.map((r) => Math.max(r.plannedPct, r.actualPct)));
  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Planned vs Actual · per milestone section</h3>
        <span className={styles.meta}>% of villas that reached each section</span>
      </div>
      <div className={styles.cardBd}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No milestone sections defined yet.</div>
        ) : (
          <div className={styles.spList}>
            {rows.map((r) => (
              <div key={r.code} className={styles.spRow}>
                <div className={styles.spLbl}>
                  <div className={styles.spName}>{r.name}</div>
                  <div className={styles.spMeta}>{r.totalVillas} villas total</div>
                </div>
                <div className={styles.spBars}>
                  <BarRow name="Planned" pct={r.plannedPct} maxPct={maxPct} tone="planned" />
                  <BarRow name="Actual" pct={r.actualPct} maxPct={maxPct} tone="actual" />
                </div>
                <div className={`${styles.spVariance} ${r.variancePct >= 0 ? styles.spVarGood : styles.spVarBad}`}>
                  {r.variancePct >= 0 ? "+" : ""}{r.variancePct.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BarRow({ name, pct, maxPct, tone }: { name: string; pct: number; maxPct: number; tone: "planned" | "actual" }) {
  const width = maxPct > 0 ? Math.max(0, Math.min(100, (pct / maxPct) * 100)) : 0;
  return (
    <div className={styles.barRow}>
      <span className={styles.barLbl}>{name}</span>
      <div className={styles.barTrack}>
        <div className={`${styles.barFill} ${tone === "planned" ? styles.barFillPlanned : styles.barFillActual}`} style={{ width: `${width}%` }} />
      </div>
      <span className={styles.barVal}>{pct.toFixed(2)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §2 — Villa-wise physical progress table
// ---------------------------------------------------------------------------

type VillaSortKey = "villaLabel" | "blockCode" | "currentSection" | "pctComplete" | "slipDays" | "status";
type SortDir = "asc" | "desc";

function VillaProgressCard({ projectId, rows }: { projectId: string; rows: VillaProgressRow[] }) {
  const [sortKey, setSortKey] = useState<VillaSortKey>("blockCode");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const getVal = (r: VillaProgressRow): string | number => {
      switch (sortKey) {
        case "villaLabel":     return r.villaNumber; // sort by number, not label
        case "blockCode":      return r.blockCode;
        case "currentSection": return r.currentSectionOrder ?? 999;
        case "pctComplete":    return r.pctComplete;
        case "slipDays":       return r.slipDays;
        case "status":         return statusRank(r.status);
      }
    };
    return [...rows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Secondary sort by villa number for stability.
      return a.villaNumber - b.villaNumber;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: VillaSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Physical Progress · villa-wise</h3>
        <span className={styles.meta}>one row per villa · click drill-in from Dashboard for details</span>
      </div>
      <div className={styles.cardBd}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>No villas in scope yet.</div>
        ) : (
          <div className={styles.vpTblWrap}>
            <table className={styles.vpTbl}>
              <thead>
                <tr>
                  <SortableTh label="Villa"           active={sortKey === "villaLabel"}     dir={sortDir} onClick={() => toggleSort("villaLabel")} />
                  <SortableTh label="Block"           active={sortKey === "blockCode"}      dir={sortDir} onClick={() => toggleSort("blockCode")} />
                  <SortableTh label="Current section" active={sortKey === "currentSection"} dir={sortDir} onClick={() => toggleSort("currentSection")} />
                  <SortableTh label="% complete"      active={sortKey === "pctComplete"}    dir={sortDir} onClick={() => toggleSort("pctComplete")} align="right" />
                  <SortableTh label="Slip"            active={sortKey === "slipDays"}       dir={sortDir} onClick={() => toggleSort("slipDays")} align="right" />
                  <SortableTh label="Status"          active={sortKey === "status"}         dir={sortDir} onClick={() => toggleSort("status")} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.villaId}>
                    <td>
                      <Link href={`/projects/${projectId}/overview?vn=${r.villaNumber}`} scroll={false} className={styles.vpVillaLink}>
                        {r.villaLabel}
                        {r.villaType && <span className={styles.vpVillaType}>{r.villaType}</span>}
                      </Link>
                    </td>
                    <td className={styles.vpBlockCell}>Block {r.blockCode}</td>
                    <td>{r.currentSectionName ?? <span className={styles.vpMuted}>Not started</span>}</td>
                    <td className={styles.vpNum}>
                      <div className={styles.vpPctWrap}>
                        <div className={styles.vpPctTrack}>
                          <div
                            className={`${styles.vpPctFill} ${r.status === "critical" ? styles.vpPctBad : r.status === "warning" ? styles.vpPctWarn : styles.vpPctGood}`}
                            style={{ width: `${Math.max(0, Math.min(100, r.pctComplete))}%` }}
                          />
                        </div>
                        <span className={styles.vpPctVal}>{r.pctComplete}%</span>
                      </div>
                    </td>
                    <td className={`${styles.vpNum} ${r.slipDays > 30 ? styles.vpSlipBad : r.slipDays > 7 ? styles.vpSlipWarn : styles.vpSlipZero}`}>
                      {r.slipDays === 0 ? "0d" : `+${r.slipDays}d`}
                    </td>
                    <td className={styles.vpStatusCell}>
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function statusRank(s: VillaProgressRow["status"]): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : s === "healthy" ? 2 : 3;
}

function StatusPill({ status }: { status: VillaProgressRow["status"] }) {
  const config = {
    critical:    { label: "Critical",    cls: styles.pillBad },
    warning:     { label: "Warning",     cls: styles.pillWarn },
    healthy:     { label: "On track",    cls: styles.pillGood },
    "not-started": { label: "Not started", cls: styles.pillMuted },
  }[status];
  return <span className={`${styles.pill} ${config.cls}`}>{config.label}</span>;
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "right";
}) {
  return (
    <th className={align === "right" ? styles.thRight : ""}>
      <button type="button" onClick={onClick} className={`${styles.thBtn} ${active ? styles.thBtnActive : ""}`}>
        {label}
        <ArrowUpDown size={11} className={active ? styles.thIconActive : styles.thIcon} />
        {active && <span className={styles.thDir}>{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// §3 — Interactive Drawing
// ---------------------------------------------------------------------------

function InteractiveDrawingCard({
  projectId,
  canEdit,
  data,
}: {
  projectId: string;
  canEdit: boolean;
  data: InteractiveDrawingData;
}) {
  const [selectedSectionCode, setSelectedSectionCode] = useState<string | null>(null);

  // Summary counts for the selected section — or overall if none selected.
  const sectionIndex = useMemo(() => {
    if (!selectedSectionCode) return null;
    const i = data.sections.findIndex((s) => s.code === selectedSectionCode);
    return i === -1 ? null : i;
  }, [selectedSectionCode, data.sections]);

  const summary = useMemo(() => {
    const counts: Record<VillaSectionStatus, number> = { completed: 0, ongoing: 0, delayed: 0, "not-started": 0 };
    const villasByStatus: Record<VillaSectionStatus, Array<{ villaNumber: number; villaLabel: string; blockCode: string; slipDays: number }>> = {
      completed: [], ongoing: [], delayed: [], "not-started": [],
    };
    if (sectionIndex == null) {
      // Overall — worst status per villa across sections
      for (const v of data.villas) {
        let worst: VillaSectionStatus = "not-started";
        let worstSlip = 0;
        for (const c of v.cells) {
          if (c.status === "delayed") worst = "delayed";
          else if (c.status === "ongoing" && worst !== "delayed") worst = "ongoing";
          else if (c.status === "completed" && worst === "not-started") worst = "completed";
          if (c.slipDays > worstSlip) worstSlip = c.slipDays;
        }
        counts[worst]++;
        villasByStatus[worst].push({ villaNumber: v.villaNumber, villaLabel: v.villaLabel, blockCode: v.blockCode, slipDays: worstSlip });
      }
    } else {
      for (const v of data.villas) {
        const cell = v.cells[sectionIndex];
        counts[cell.status]++;
        villasByStatus[cell.status].push({ villaNumber: v.villaNumber, villaLabel: v.villaLabel, blockCode: v.blockCode, slipDays: cell.slipDays });
      }
    }
    return { counts, villasByStatus };
  }, [sectionIndex, data.villas]);

  return (
    <section className={styles.card}>
      <div className={styles.cardHd}>
        <h3>Interactive Drawing</h3>
        <span className={styles.meta}>
          {selectedSectionCode
            ? `filtered by ${data.sections.find((s) => s.code === selectedSectionCode)?.name}`
            : "overall villa status"}
        </span>
      </div>
      <div className={styles.cardBd}>
        <div className={styles.idGrid}>
          {/* Left: the master plan or empty state */}
          <div className={styles.idImageCol}>
            {data.masterPlanUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.masterPlanUrl} alt="Site master plan" className={styles.idImage} />
            ) : (
              <MasterPlanEmpty projectId={projectId} canEdit={canEdit} />
            )}
            {data.masterPlanUrl && canEdit && (
              <div className={styles.idImageActions}>
                <MasterPlanReplace projectId={projectId} />
              </div>
            )}
            {data.masterPlanUrl && (
              <p className={styles.idHint}>
                Clickable villa zones on the drawing itself require per-villa
                coordinates — that&apos;s a follow-up. For now use the status
                lists on the right to see which villas fall into each bucket.
              </p>
            )}
          </div>

          {/* Right: section filter + status summary */}
          <div className={styles.idSideCol}>
            <div className={styles.idSummary}>
              <SummaryTile label="Completed" count={summary.counts.completed} tone="good" />
              <SummaryTile label="Ongoing" count={summary.counts.ongoing} tone="warn" />
              <SummaryTile label="Delayed" count={summary.counts.delayed} tone="bad" />
              <SummaryTile label="Not started" count={summary.counts["not-started"]} tone="muted" />
            </div>

            <div className={styles.idFilterHd}>Filter by section</div>
            <div className={styles.idChipRow}>
              <button
                type="button"
                className={`${styles.idChip} ${selectedSectionCode === null ? styles.idChipOn : ""}`}
                onClick={() => setSelectedSectionCode(null)}
              >
                Overall
              </button>
              {data.sections.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className={`${styles.idChip} ${selectedSectionCode === s.code ? styles.idChipOn : ""}`}
                  onClick={() => setSelectedSectionCode(s.code)}
                >
                  {s.name}
                </button>
              ))}
            </div>

            {/* Per-status villa lists */}
            <div className={styles.idVillaLists}>
              {(["delayed", "ongoing", "completed", "not-started"] as VillaSectionStatus[]).map((status) => {
                const list = summary.villasByStatus[status];
                if (list.length === 0) return null;
                return (
                  <div key={status} className={styles.idVillaGroup}>
                    <div className={`${styles.idVillaGroupHd} ${styles[`idVg_${status}` as keyof typeof styles] ?? ""}`}>
                      <span>{statusLabel(status)}</span>
                      <span className={styles.idVillaGroupCount}>{list.length}</span>
                    </div>
                    <div className={styles.idVillaChips}>
                      {list.sort((a, b) => b.slipDays - a.slipDays).map((v) => (
                        <Link
                          key={v.villaNumber}
                          href={`/projects/${projectId}/overview?vn=${v.villaNumber}`}
                          scroll={false}
                          className={`${styles.idVillaChip} ${styles[`idVc_${status}` as keyof typeof styles] ?? ""}`}
                        >
                          V{v.villaNumber}
                          {v.slipDays > 0 && <span className={styles.idVillaChipSlip}>+{v.slipDays}d</span>}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function statusLabel(s: VillaSectionStatus): string {
  return s === "completed" ? "Completed"
       : s === "ongoing"   ? "Ongoing"
       : s === "delayed"   ? "Delayed"
       :                     "Not started";
}

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: "good" | "warn" | "bad" | "muted" }) {
  const cls = tone === "good" ? styles.stGood : tone === "warn" ? styles.stWarn : tone === "bad" ? styles.stBad : styles.stMuted;
  return (
    <div className={`${styles.summaryTile} ${cls}`}>
      <div className={styles.stCount}>{count}</div>
      <div className={styles.stLbl}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Master plan upload helpers
// ---------------------------------------------------------------------------

function MasterPlanEmpty({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  return (
    <div className={styles.mpEmpty}>
      <div className={styles.mpEmptyIcon}>🗺️</div>
      <div className={styles.mpEmptyTitle}>No master plan uploaded yet</div>
      <p className={styles.mpEmptyText}>
        {canEdit
          ? "Upload the site layout image (isometric aerial with villa plots labelled) so the interactive drawing renders."
          : "Ask an admin, planner, or product-team member to upload the site master plan."}
      </p>
      {canEdit && <MasterPlanUpload projectId={projectId} label="Upload master plan" />}
    </div>
  );
}

function MasterPlanUpload({ projectId, label }: { projectId: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);

  const onFile = useCallback(async (file: File) => {
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/projects/${projectId}/master-plan`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? `Upload failed (${res.status})`);
      } else {
        toast.success("Master plan uploaded.");
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPending(false);
    }
  }, [projectId, router, toast]);

  return (
    <div className={styles.mpUploadWrap}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.mpUploadInput}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = ""; // allow reselecting same file
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className={styles.mpUploadBtn}
      >
        <Upload size={14} />
        {pending ? "Uploading…" : label}
      </button>
    </div>
  );
}

function MasterPlanReplace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const onRemove = useCallback(async () => {
    if (!window.confirm("Remove the master plan? You can re-upload later.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/master-plan`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? `Delete failed (${res.status})`);
      } else {
        toast.success("Master plan removed.");
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPending(false);
    }
  }, [projectId, router, toast]);

  return (
    <div className={styles.mpReplaceRow}>
      <MasterPlanUpload projectId={projectId} label="Replace" />
      <button type="button" onClick={onRemove} disabled={pending} className={styles.mpRemoveBtn}>
        <Trash2 size={14} />
        Remove
      </button>
    </div>
  );
}
