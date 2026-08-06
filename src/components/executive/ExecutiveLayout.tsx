"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./executive.module.css";
import type { BlockRollup } from "@/lib/executiveMockData";

export interface ExecutiveLayoutProps {
  blocks: BlockRollup[];
  sections: string[];
  /** Per-active-villa slip + current section — same shape the mock uses. */
  villaSlips: Record<number, { slip: number; section: number }>;
}

type CellStatus = "stGood" | "stWarn" | "stBad" | "stSlip" | "stPending" | "stOos";

// Given a villa's currentSection + slip days, return the cell status for a
// specific milestone index. Mirrors the mockup's classification.
function cellStatusFor(
  villaCurrentSection: number,
  villaSlipDays: number,
  targetSection: number,
): CellStatus {
  if (villaCurrentSection < 0) return "stOos"; // block not started
  if (targetSection < villaCurrentSection) {
    // completed milestone — color by delay it inherited
    if (villaSlipDays === 0) return "stGood";
    if (villaSlipDays <= 7) return "stWarn";
    return "stBad";
  }
  if (targetSection === villaCurrentSection) {
    // in progress — slip if villa has any slip, else pending
    return villaSlipDays > 0 ? "stSlip" : "stPending";
  }
  return "stPending"; // future milestone
}

// Overall villa color when no milestone filter selected.
function overallStatus(villaCurrentSection: number, villaSlipDays: number): CellStatus {
  if (villaCurrentSection < 0) return "stOos";
  if (villaSlipDays === 0) return "stGood";
  if (villaSlipDays > 30) return "stSlip";
  if (villaSlipDays > 7) return "stBad";
  return "stWarn";
}

export default function ExecutiveLayout({ blocks, sections, villaSlips }: ExecutiveLayoutProps) {
  const [selected, setSelected] = useState<number | null>(null); // section index, or null for overall

  const activeBlocks = blocks.filter((b) => b.active);
  const inactiveBlocks = blocks.filter((b) => !b.active);

  const cellFor = (villaNum: number) => {
    const profile = villaSlips[villaNum];
    if (!profile) return "stOos";
    return selected === null
      ? overallStatus(profile.section, profile.slip)
      : cellStatusFor(profile.section, profile.slip, selected);
  };

  // Filter summary counts
  const summary = useMemo(() => {
    const counts = { good: 0, warn: 0, bad: 0, slip: 0, pending: 0, oos: 0 };
    for (const b of activeBlocks) {
      for (const n of b.villas) {
        const s = cellFor(n);
        if (s === "stGood") counts.good++;
        else if (s === "stWarn") counts.warn++;
        else if (s === "stBad") counts.bad++;
        else if (s === "stSlip") counts.slip++;
        else if (s === "stPending") counts.pending++;
        else counts.oos++;
      }
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className={styles.wrap}>
      {/* Toolbar: milestone chip filter + legend + summary */}
      <div className={styles.layoutToolbar}>
        <div className={styles.toolbarLbl}>Select Milestone to Filter Layout</div>
        <div className={styles.milChipRow}>
          <button
            className={`${styles.milChip} ${selected === null ? styles.on : ""}`}
            onClick={() => setSelected(null)}
          >
            Overall status
          </button>
          {sections.map((name, i) => (
            <button
              key={name}
              className={`${styles.milChip} ${selected === i ? styles.on : ""}`}
              onClick={() => setSelected(i)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className={styles.statusLegend}>
          <span><span className={`${styles.sw} ${styles.stGood}`} />Completed on-time</span>
          <span><span className={`${styles.sw} ${styles.stWarn}`} />Completed · delay ≤7d</span>
          <span><span className={`${styles.sw} ${styles.stBad}`} />Completed · delay &gt;7d</span>
          <span><span className={`${styles.sw} ${styles.stSlip}`} />Pending &amp; projected to delay</span>
          <span><span className={`${styles.sw} ${styles.stPending}`} />Pending · no projected delay</span>
          <span><span className={`${styles.sw} ${styles.stOos}`} />Not in scope / not started</span>
        </div>
        <div className={styles.filterSummary}>
          <span className={styles.fsLbl}>
            {selected === null ? "Overall villa status" : `Milestone: ${sections[selected]}`}
          </span>
          <span className={styles.sep}>·</span>
          <span className={styles.cGood}>{summary.good} on-time</span>
          <span className={styles.sep}>·</span>
          <span className={styles.cWarn}>{summary.warn + summary.bad} with delay</span>
          <span className={styles.sep}>·</span>
          <span className={styles.cBad}>{summary.slip} projected slip</span>
          <span className={styles.sep}>·</span>
          <span className={styles.cPending}>{summary.pending} pending</span>
        </div>
      </div>

      {/* Layout grid */}
      <div className={styles.layoutWrap}>
        <div className={styles.layoutHd}>
          <h3>Block Layout · Contractor Abraham Thomas</h3>
          <span className={styles.meta}>
            {selected === null ? "default view — overall villa status" : `filtered by ${sections[selected]}`}
          </span>
        </div>
        <div className={styles.layoutBody}>
          <div className={styles.layoutSectionHd}>
            Active Blocks <span className={styles.n}>{activeBlocks.length}</span>
          </div>
          <div className={styles.blockGroups}>
            {activeBlocks.map((b) => (
              <BlockGrid key={b.code} block={b} cellFor={cellFor} />
            ))}
          </div>
          <div className={styles.layoutSectionHd}>
            Not Yet Started <span className={styles.n}>{inactiveBlocks.length}</span>
          </div>
          <div className={styles.blockGroups}>
            {inactiveBlocks.map((b) => (
              <BlockGrid key={b.code} block={b} cellFor={cellFor} dim />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockGrid({
  block,
  cellFor,
  dim,
}: {
  block: BlockRollup;
  cellFor: (villaNum: number) => CellStatus;
  dim?: boolean;
}) {
  // Column count — try to make roughly square
  const n = block.villas.length;
  const cols = n <= 2 ? Math.max(1, n) : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
  const colsClass =
    cols === 1 ? styles.cols1 : cols === 2 ? styles.cols2 : cols === 3 ? styles.cols3 : styles.cols4;

  return (
    <div className={`${styles.blockGroup} ${dim ? styles.dim : ""}`}>
      <h4>
        <Link
          href={`?bd=${encodeURIComponent(block.code)}`}
          scroll={false}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          Block {block.code}
        </Link>
        <span className="sub">{block.pod}</span>
      </h4>
      <div className={`${styles.villaGrid} ${colsClass}`}>
        {block.villas.map((n) => {
          const status = cellFor(n);
          const isOos = status === "stOos";
          const inner = (
            <div
              className={`${styles.villaBox} ${styles[status]}`}
              title={`Villa ${n} · Block ${block.code}`}
            >
              {n}
            </div>
          );
          // Not-in-scope villas aren't clickable (no data to drill into).
          if (isOos) return <div key={n}>{inner}</div>;
          return (
            <Link
              key={n}
              href={`?vn=${n}`}
              scroll={false}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
