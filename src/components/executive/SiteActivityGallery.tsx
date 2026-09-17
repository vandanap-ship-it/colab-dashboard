"use client";

import { useState } from "react";
import executiveStyles from "./executive.module.css";
import galleryStyles from "./siteActivityGallery.module.css";
import { Lightbox, type Photo } from "@/components/PhotoStrip";
import type { GalleryDateGroup, GalleryItem } from "@/lib/dashboardSectionsServer";

// Gallery has its own CSS module as of Phase B — 160-odd lines that used to
// live at the bottom of executive.module.css. Empty-state falls back to the
// shared .sahEmpty class over on executive.module.css.
const styles = { ...executiveStyles, ...galleryStyles } as typeof executiveStyles & typeof galleryStyles;

interface Props {
  groups: GalleryDateGroup[];
  projectName: string;
}

/**
 * Chronological photo wall of every site-activity image in the project.
 * Two-level grouping per Shraddha's Sep 17 note: outer sections are DATE,
 * inner sub-sections are BLOCK. Within a block, one tile per photo (a
 * progress entry with 5 photos = 5 tiles, so the grid reads as a wall
 * of shots rather than a stack of collapsed cards).
 *
 * Clicking a tile opens the same PhotoStrip Lightbox used on scorecard
 * §04: caption strip (block · villa · activity · date · %), arrow keys
 * navigate the entry's sibling photos, Download composes a descriptive
 * filename.
 */
export default function SiteActivityGallery({ groups, projectName }: Props) {
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);

  if (groups.length === 0) {
    return (
      <div className={styles.sahEmpty}>
        No photos uploaded yet. As the site team logs progress on their
        phones, every photo will surface here — grouped by date and block,
        newest first.
      </div>
    );
  }

  return (
    <>
      <div className={styles.galleryWrap}>
        {groups.map((dateGroup) => {
          const totalPhotos = dateGroup.blocks.reduce((n, b) => n + b.items.length, 0);
          return (
            <div key={dateGroup.dateISO} className={styles.galleryDateSection}>
              <div className={styles.galleryDateHd}>
                {fmtDateLong(dateGroup.dateISO)}
                <span className={styles.galleryDateCount}>
                  {totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {dateGroup.blocks.length} block{dateGroup.blocks.length === 1 ? "" : "s"}
                </span>
              </div>
              {dateGroup.blocks.map((block) => (
                <div key={block.blockCode} className={styles.galleryBlockSection}>
                  <div className={styles.galleryBlockHd}>
                    <span className={styles.galleryBlockName}>
                      {block.blockCode === "Untagged" ? "Untagged" : `Block ${block.blockCode}`}
                    </span>
                    <span className={styles.galleryBlockCount}>
                      {block.items.length} photo{block.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className={styles.galleryGrid}>
                    {block.items.map((it) => (
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
          );
        })}
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
          <span className={styles.galleryChip}>{item.villaLabel}</span>
        </div>
        <div className={styles.galleryOverlayBot}>
          <div className={styles.galleryActivity}>{item.activityName}</div>
        </div>
      </div>
    </button>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDateLong(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
