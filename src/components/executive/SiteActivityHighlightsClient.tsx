"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./executive.module.css";
import { Lightbox, type Photo } from "@/components/PhotoStrip";
import type { SiteActivityBlockGroup, SiteActivity } from "@/lib/dashboardSectionsServer";

interface Props {
  groups: SiteActivityBlockGroup[];
  projectName: string;
}

/**
 * Client wrapper for the Site Activity Highlights section on the Dashboard.
 *
 * Previously rendered plain <img> tags — clicking a thumbnail did nothing.
 * Now clicks open the same fullscreen PhotoStrip Lightbox we already use on
 * the Scorecard §04 cards: metadata caption strip (block · villa · activity ·
 * date · %), Download button with a descriptive filename, keyboard arrow
 * navigation when the entry has multiple photos.
 */
export default function SiteActivityHighlightsClient({ groups, projectName }: Props) {
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);

  if (groups.length === 0) {
    return (
      <div className={styles.sahEmpty}>
        Nothing logged today. Site activities will appear here as engineers
        submit progress on their phones.
      </div>
    );
  }
  return (
    <>
      <div className={styles.sahList}>
        {groups.map((g) => (
          <div key={g.blockCode} className={styles.sahBlockGroup}>
            <div className={styles.sahBlockHd}>
              Block {g.blockCode}
              <span className={styles.sahBlockCount}>
                {g.villas.reduce((n, v) => n + v.activities.length, 0)} activities · {g.villas.length} villas
              </span>
            </div>
            {g.villas.map((v) => (
              <div key={v.villaNumber} className={styles.sahVillaBlock}>
                <div className={styles.sahVillaHd}>
                  <Link
                    href={`?vn=${v.villaNumber}`}
                    scroll={false}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {v.villaLabel}
                  </Link>
                  <span className={styles.sahActCount}>
                    {v.activities.length} {v.activities.length === 1 ? "activity" : "activities"}
                  </span>
                </div>
                <div className={styles.sahCardGrid}>
                  {v.activities.map((a) => (
                    <ActivityCard
                      key={a.progressEntryId}
                      activity={a}
                      villaLabel={v.villaLabel}
                      blockCode={g.blockCode}
                      projectName={projectName}
                      onOpenLightbox={(photos, index) => setLightbox({ photos, index })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function ActivityCard({
  activity: a,
  villaLabel,
  blockCode,
  projectName,
  onOpenLightbox,
}: {
  activity: SiteActivity;
  villaLabel: string;
  blockCode: string;
  projectName: string;
  onOpenLightbox: (photos: Photo[], index: number) => void;
}) {
  // Build the lightbox photo set with full metadata so the caption strip
  // reads correctly and the download filename is descriptive.
  const photos: Photo[] = (a.photos ?? []).map((p) => ({
    id: p.id,
    url: p.url,
    meta: {
      kind: "progress",
      project: projectName,
      block: blockCode,
      villa: villaLabel,
      activity: `${a.milestoneName}-${a.activityName}`,
      date: a.entryDate,
      percent: a.achievedPct ?? undefined,
    },
  }));
  const hasPhotos = photos.length > 0;

  return (
    <div className={styles.sahCard}>
      {hasPhotos ? (
        <button
          type="button"
          className={styles.sahPhotoWrap}
          onClick={() => onOpenLightbox(photos, 0)}
          aria-label="Open photo"
          style={{
            border: 0,
            padding: 0,
            cursor: "zoom-in",
            background: "var(--ex-rule-soft)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0].url} alt="" className={styles.sahPhoto} />
          {photos.length > 1 && (
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(22, 25, 38, 0.72)",
                color: "#FFFFFF",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                padding: "3px 8px",
                borderRadius: 10,
                fontVariantNumeric: "tabular-nums",
                pointerEvents: "none",
              }}
            >
              +{photos.length - 1}
            </span>
          )}
        </button>
      ) : (
        <div className={styles.sahPhotoStub}>No photo</div>
      )}
      <div className={styles.sahCardBody}>
        <div className={styles.sahEyebrow}>{a.milestoneName}</div>
        <div className={styles.sahActName}>{a.activityName}</div>
        <div className={styles.sahMeta}>
          {a.achievedPct != null && <span className={styles.sahPct}>{Math.round(a.achievedPct)}%</span>}
          {a.overdueDays != null && <span className={styles.sahOverdue}>{a.overdueDays}d overdue</span>}
        </div>
        {a.notes && <div className={styles.sahRemark}>&ldquo;{a.notes}&rdquo;</div>}
        {(a.reasonLabel || a.reasonNote) && (
          <div className={styles.sahReason}>
            <span className={styles.sahReasonLbl}>Delay reason:</span>{" "}
            {a.reasonLabel ?? ""}{a.reasonLabel && a.reasonNote ? " · " : ""}
            {a.reasonNote ? <span className={styles.sahReasonNote}>{a.reasonNote}</span> : null}
          </div>
        )}
        <div className={styles.sahFoot}>
          {a.contractorName ?? "—"} · {a.loggedByName} · {fmtTime(a.loggedAt)}
        </div>
      </div>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
