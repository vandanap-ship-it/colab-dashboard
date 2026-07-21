"use client";

import { useMemo, useState } from "react";
import styles from "./milestoneMatrix.module.css";
import {
  MATRIX_VILLA_ORDER,
  SECTION_HEADERS,
  SECTIONS,
  CONTRACTORS,
  milestonesForVilla,
  type MilestoneCell,
} from "@/lib/executiveMockData";

// Rows shown per villa (8 sub-rows per Colab layout).
const ROW_KEYS = [
  { key: "plannedDate",       label: "Planned Date"       , cls: "" },
  { key: "actualDate",        label: "Actual Date"        , cls: "rowActual" },
  { key: "projectedDate",     label: "Projected Date"     , cls: "" },
  { key: "delayDays",         label: "Delay (days)"       , cls: "rowDelay" },
  { key: "crmDate",           label: "CRM Finish"         , cls: "" },
  { key: "crmDelayDays",      label: "CRM Delay"          , cls: "rowCrmDelay" },
  { key: "plannedCollection", label: "Planned Collection (₹)", cls: "" },
  { key: "progressPct",       label: "Progress %"         , cls: "rowProgress" },
] as const;

type RowKey = typeof ROW_KEYS[number]["key"];

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtMoney(n: number): string {
  if (!n) return "—";
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`; // Lakh
  return n.toLocaleString("en-IN");
}

function cellText(row: RowKey, cell: MilestoneCell | undefined): string {
  if (!cell) return "—";
  const v = cell[row];
  if (row === "plannedDate" || row === "actualDate" || row === "projectedDate" || row === "crmDate") {
    return fmtDate(v as Date | null);
  }
  if (row === "plannedCollection") return fmtMoney(v as number);
  if (row === "progressPct") return `${v ?? 0}%`;
  return v == null ? "—" : String(v);
}

export default function MilestoneMatrix() {
  const [selectedVillas, setSelectedVillas] = useState<number[]>([]);
  const [selectedSections, setSelectedSections] = useState<number[]>([]);
  const [contractor, setContractor] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [applied, setApplied] = useState({ villas: [] as number[], sections: [] as number[], contractor: "", from: "", to: "" });

  const apply = () => {
    setApplied({
      villas: selectedVillas,
      sections: selectedSections,
      contractor,
      from: fromDate,
      to: toDate,
    });
  };
  const clear = () => {
    setSelectedVillas([]);
    setSelectedSections([]);
    setContractor("");
    setFromDate("");
    setToDate("");
    setApplied({ villas: [], sections: [], contractor: "", from: "", to: "" });
  };

  const villasToShow = useMemo(() => {
    return applied.villas.length ? applied.villas : MATRIX_VILLA_ORDER;
  }, [applied.villas]);

  const sectionIndexes = useMemo(() => {
    const all = SECTIONS.map((_, i) => i);
    if (!applied.sections.length) return all;
    return all.filter((i) => applied.sections.includes(i));
  }, [applied.sections]);

  // Row-level date filter: keep villa only if any of its shown milestones has a
  // planned/actual/projected date within [from, to].
  const filteredVillas = useMemo(() => {
    if (!applied.from && !applied.to) return villasToShow;
    const from = applied.from ? new Date(applied.from) : null;
    const to = applied.to ? new Date(applied.to) : null;
    return villasToShow.filter((v) => {
      const cells = milestonesForVilla(v);
      return sectionIndexes.some((i) => {
        const c = cells[i];
        if (!c) return false;
        const d = c.actualDate ?? c.projectedDate ?? c.plannedDate;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    });
  }, [villasToShow, sectionIndexes, applied.from, applied.to]);

  return (
    <div className={styles.wrap}>
      <div className={styles.hd}>
        <h3>Milestone Matrix</h3>
        <span className={styles.meta}>
          per villa × milestone · planned vs actual vs CRM collection
        </span>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <label htmlFor="mm-loc">Location (Villa)</label>
          <select
            id="mm-loc"
            multiple
            size={1}
            value={selectedVillas.map(String)}
            onChange={(e) =>
              setSelectedVillas(
                Array.from(e.target.selectedOptions, (o) => Number(o.value))
              )
            }
          >
            {MATRIX_VILLA_ORDER.map((v) => (
              <option key={v} value={v}>Villa {v}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="mm-mile">Milestone</label>
          <select
            id="mm-mile"
            multiple
            size={1}
            value={selectedSections.map(String)}
            onChange={(e) =>
              setSelectedSections(
                Array.from(e.target.selectedOptions, (o) => Number(o.value))
              )
            }
          >
            {SECTIONS.map((s, i) => (
              <option key={s} value={i}>{s}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="mm-contr">Contractor</label>
          <select
            id="mm-contr"
            value={contractor}
            onChange={(e) => setContractor(e.target.value)}
          >
            <option value="">All contractors</option>
            {CONTRACTORS.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterField}>
          <label htmlFor="mm-from">From Date</label>
          <input
            id="mm-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className={styles.filterField}>
          <label htmlFor="mm-to">To Date</label>
          <input
            id="mm-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className={styles.filterButtons}>
          <button className={styles.applyBtn} onClick={apply}>Apply</button>
          <button className={styles.clearBtn} onClick={clear}>Clear</button>
        </div>
      </div>

      {/* Matrix table */}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.first}>Villa</th>
              <th className={styles.second}>Metric</th>
              {sectionIndexes.map((i) => (
                <th key={i}>{SECTION_HEADERS[i]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredVillas.length === 0 ? (
              <tr>
                <td colSpan={sectionIndexes.length + 2} className={styles.empty}>
                  No villas match the applied filters.
                </td>
              </tr>
            ) : (
              filteredVillas.flatMap((v) => {
                const cells = milestonesForVilla(v);
                return ROW_KEYS.map((row, rIdx) => (
                  <tr
                    key={`${v}-${row.key}`}
                    className={[
                      rIdx === 0 ? styles.villaStart : "",
                      row.cls ? styles[row.cls] : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {rIdx === 0 && (
                      <td
                        rowSpan={ROW_KEYS.length}
                        className={styles.villaName}
                      >
                        Villa {v}
                      </td>
                    )}
                    <td className={styles.rowLabel}>{row.label}</td>
                    {sectionIndexes.map((i) => {
                      const c = cells[i];
                      const txt = cellText(row.key, c);
                      const isMoney = row.key === "plannedCollection";
                      const isZero = txt === "—" || txt === "0%" || txt === "0";
                      return (
                        <td
                          key={i}
                          className={[
                            styles.cell,
                            isMoney ? styles.money : "",
                            isZero ? styles.zero : "",
                          ].filter(Boolean).join(" ")}
                        >
                          {txt}
                        </td>
                      );
                    })}
                  </tr>
                ));
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.summary}>
        <span>Showing <strong>{filteredVillas.length}</strong> villas ×{" "}
          <strong>{sectionIndexes.length}</strong> milestones
        </span>
        {applied.from && <span>From <strong>{applied.from}</strong></span>}
        {applied.to && <span>To <strong>{applied.to}</strong></span>}
        {applied.contractor && <span>Contractor: <strong>{applied.contractor}</strong></span>}
      </div>
    </div>
  );
}
