import type { ReactNode } from "react";
import styles from "../scorecard.module.css";

/**
 * Numbered scorecard section shell — §01…§04 all wrap in this.
 *
 * Kept lightweight (no state, no lightbox concerns) so the print-safe CSS
 * from scorecard.module.css keeps sole ownership of the layout. Extracted
 * from the pre-Phase-B monolithic ScorecardView.tsx.
 */
export default function ScorecardSection({
  num,
  title,
  meta,
  children,
}: {
  num: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHd}>
        <span className={styles.sectionNum}>{num}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {meta && <div className={styles.sectionMeta}>{meta}</div>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
