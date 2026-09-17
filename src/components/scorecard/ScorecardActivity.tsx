import styles from "../scorecard.module.css";
import type { Scorecard } from "@/lib/scorecardServer";
import type { Photo } from "../PhotoStrip";
import ScorecardSection from "./ScorecardSection";

/**
 * §04 — Site Activity Highlights. Grouped by block > villa > activity cards.
 * Extracted from ScorecardView.tsx during Phase B so the parent orchestrator
 * stays readable and §04's ~130-line render doesn't compete with §01-§03
 * for reader attention.
 *
 * Photo clicks fire back to the parent's lightbox via onOpenLightbox — the
 * lightbox itself still lives on the parent (single instance across the
 * report), which is why this component doesn't own it.
 */
export default function ScorecardActivity({
  activityHighlights,
  projectName,
  asOfLabel,
  onOpenLightbox,
}: {
  activityHighlights: Scorecard["activityHighlights"];
  projectName: string;
  asOfLabel: string;
  onOpenLightbox: (photos: Photo[], index: number) => void;
}) {
  return (
    <ScorecardSection
      num="04"
      title="Site Activity Highlights"
      meta={`activities logged on ${asOfLabel} · grouped block then villa`}
    >
      {activityHighlights.length === 0 ? (
        <div className={styles.empty}>Nothing logged today.</div>
      ) : (
        activityHighlights.map((g) => (
          <div key={g.blockCode} className={styles.actGroup}>
            <div className={styles.actBlockHd}>Block {g.blockCode}</div>
            {g.villas.map((v) => {
              const count = v.activities.length;
              // Milestone chip in the villa header — matches the reference
              // PDF's `.sa-mile` label. Reads the most-common milestone
              // across the villa's activities so the label stays informative
              // when they straddle two milestones (rare on Amanvana today).
              const mileCounts = new Map<string, number>();
              for (const a of v.activities) {
                if (!a.milestoneName || a.milestoneName === "—") continue;
                mileCounts.set(a.milestoneName, (mileCounts.get(a.milestoneName) ?? 0) + 1);
              }
              let milestoneLabel: string | null = null;
              let best = 0;
              for (const [name, n] of mileCounts) {
                if (n > best) { best = n; milestoneLabel = name; }
              }
              return (
                <div key={v.villaNumber}>
                  <div className={styles.actVillaHd}>
                    <span className={styles.actVillaName}>{v.villaLabel}</span>
                    {milestoneLabel && <span className={styles.actMile}>{milestoneLabel}</span>}
                    <span className={styles.actVillaCount}>
                      {count} {count === 1 ? "activity" : "activities"} logged
                    </span>
                  </div>
                  <div className={styles.actCards}>
                    {v.activities.map((a) => {
                      const done = a.achievedPct != null && a.achievedPct >= 100;
                      const entryDay = new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                      const entryFull = new Date(a.entryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                      const reason = [a.reasonLabel, a.reasonNote].filter(Boolean).join(" · ");
                      const cardPhotos: Photo[] = (a.photos ?? []).map((p) => ({
                        id: p.id,
                        url: p.url,
                        meta: {
                          kind: "progress",
                          project: projectName,
                          block: g.blockCode,
                          villa: v.villaLabel,
                          activity: `${a.milestoneName}-${a.activityName}`,
                          date: a.entryDate,
                          percent: a.achievedPct ?? undefined,
                        },
                      }));
                      return (
                        <div key={a.progressEntryId} className={styles.actCard}>
                          {cardPhotos.length > 0 ? (
                            <button
                              type="button"
                              className={styles.actPhoto}
                              onClick={() => onOpenLightbox(cardPhotos, 0)}
                              aria-label="Open photo"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={cardPhotos[0].url} alt="" />
                              {cardPhotos.length > 1 && (
                                <span className={styles.actPhotoCount}>+{cardPhotos.length - 1}</span>
                              )}
                            </button>
                          ) : (
                            <div className={styles.actPhotoStub}>Photo not uploaded</div>
                          )}
                          <div className={styles.actInfo}>
                            <div className={styles.actName}>
                              {a.milestoneName} · {a.activityName}
                            </div>
                            {a.achievedPct != null && (
                              <div className={styles.actStatus}>
                                <span className={`${styles.actPill} ${done ? styles.done : styles.wip}`}>
                                  {Math.round(a.achievedPct)}% complete · {done ? "done" : "in progress"}
                                </span>
                              </div>
                            )}
                            {a.dailyDeltaPct != null && a.dailyDeltaPct > 0 && (
                              <div className={styles.actDay}>
                                {a.dailyDeltaPct}% completed on {entryDay}
                              </div>
                            )}
                            {a.plannedEndDate && (
                              <div className={styles.actDelay}>
                                Planned end {new Date(a.plannedEndDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                {a.daysToPlannedEnd != null && a.daysToPlannedEnd < 0 && (
                                  <> · <b className={styles.actDelayBad}>{done ? "completed" : ""} {Math.abs(a.daysToPlannedEnd)} days {done ? "late" : "overdue"}</b></>
                                )}
                                {a.daysToPlannedEnd != null && a.daysToPlannedEnd > 0 && (
                                  <> · {a.daysToPlannedEnd} days to planned end</>
                                )}
                                {a.daysToPlannedEnd === 0 && (
                                  <> · <b className={styles.actDelayBad}>due today</b></>
                                )}
                              </div>
                            )}
                            {a.notes && (
                              <div className={styles.actField}>
                                <span className={styles.actFieldLbl}>Remark</span>
                                {a.notes}
                              </div>
                            )}
                            <div className={styles.actField}>
                              <span className={styles.actFieldLbl}>Delay Reason</span>
                              {reason || "—"}
                            </div>
                            <div className={styles.actFoot}>
                              {a.contractorName ?? "Untagged"} · {entryFull}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </ScorecardSection>
  );
}
