"use client";

import { useState } from "react";
import styles from "./executive.module.css";
import { Lightbox, type Photo } from "@/components/PhotoStrip";
import type { GalleryItem } from "@/lib/dashboardSectionsServer";

interface Props {
  items: GalleryItem[];
  projectName: string;
}

/**
 * Chronological grid of every site-activity photo in the project, newest
 * first. Replaces the older "today only" grouped highlights on the
 * Dashboard — Shraddha asked for a proper gallery of everything uploaded.
 *
 * One tile per photo, not per entry (an entry with 5 photos = 5 tiles), so
 * the grid reads as a photo wall rather than a stack of cards. Clicking a
 * tile opens the same PhotoStrip lightbox used on the scorecard §04 cards:
 * caption strip with block · villa · activity · date, arrow keys navigate
 * the entry's sibling photos, Download composes a descriptive filename.
 *
 * Grouping by month header keeps a long scroll orientable without paging.
 */
export default function SiteActivityGallery({ items, projectName }: Props) {
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);

  if (items.length === 0) {
    return (
      <div className={styles.sahEmpty}>
        No photos uploaded yet. As the site team logs progress on their
        phones, every photo will surface here — newest first.
      </div>
    );
  }

  // Group by month for scroll orientation.
  const monthBuckets = new Map<string, GalleryItem[]>();
  for (const it of items) {
    const key = monthKey(it.entryDate);
    if (!monthBuckets.has(key)) monthBuckets.set(key, []);
    monthBuckets.get(key)!.push(it);
  }
  const months = [...monthBuckets.keys()]; // insertion order = newest first

  return (
    <>
      <div className={styles.galleryWrap}>
        {months.map((m) => (
          <div key={m} className={styles.gallerySection}>
            <div className={styles.galleryMonthHd}>
              {monthLabel(m)}
              <span className={styles.galleryMonthCount}>
                {monthBuckets.get(m)!.length} photo{monthBuckets.get(m)!.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.galleryGrid}>
              {monthBuckets.get(m)!.map((it) => (
                <GalleryTile
                  key={`${it.progressEntryId}::${it.photoId}`}
                  item={it}
                  projectName={projectName}
                  onOpen={(photos, index) => setLightbox({ photos, index })}
                />
              ))}
            </div>
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

function GalleryTile({
  item,
  projectName,
  onOpen,
}: {
  item: GalleryItem;
  projectName: string;
  onOpen: (photos: Photo[], index: number) => void;
}) {
  const photos: Photo[] = item.siblingPhotos.map((p) => ({
    id: p.id,
    url: p.url,
    meta: {
      kind: "progress",
      project: projectName,
      block: item.blockCode ?? undefined,
      villa: item.villaLabel,
      activity: `${item.milestoneName}-${item.activityName}`,
      date: item.entryDate,
      percent: item.achievedPct ?? undefined,
    },
  }));

  return (
    <button
      type="button"
      className={styles.galleryTile}
      onClick={() => onOpen(photos, item.photoIndex)}
      aria-label={`Open photo — ${item.villaLabel} · ${item.activityName}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.photoUrl} alt="" className={styles.galleryPhoto} loading="lazy" />
      {item.photoCount > 1 && (
        <span className={styles.galleryCountBadge}>
          {item.photoIndex + 1}/{item.photoCount}
        </span>
      )}
      <div className={styles.galleryOverlay}>
        <div className={styles.galleryOverlayTop}>
          {item.blockCode && (
            <span className={styles.galleryChip}>Block {item.blockCode}</span>
          )}
          <span className={styles.galleryChip}>{item.villaLabel}</span>
        </div>
        <div className={styles.galleryOverlayBot}>
          <div className={styles.galleryActivity}>{item.activityName}</div>
          <div className={styles.galleryDate}>{fmtShortDate(item.entryDate)}</div>
        </div>
      </div>
    </button>
  );
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
