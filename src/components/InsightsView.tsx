"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Info, Lightbulb, Zap } from "lucide-react";
import styles from "./insights.module.css";
import InsightsPanels from "./InsightsPanels";
import type { Insight, InsightSeverity } from "@/lib/insightsServer";

export interface InsightsViewProps {
  projectId: string;
  insights: Insight[];
}

/**
 * Insights tab:
 *   Top — auto-generated "smart callouts" from rules that scan the project's
 *   current state and surface patterns worth acting on.
 *   Bottom — the existing labour vs progress vs hindrance trend chart
 *   (InsightsPanels), kept for continuity.
 *
 * Rules live in src/lib/insightsServer.ts. Each is deterministic — no AI —
 * so a card can be traced back to a specific query the user can verify.
 */
export default function InsightsView({ projectId, insights }: InsightsViewProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <span>Smart Callouts</span>
          <span className={styles.cardMeta}>
            {insights.length === 0
              ? "Everything looks steady — no callouts triggered today."
              : `${insights.length} pattern${insights.length === 1 ? "" : "s"} worth acting on`}
          </span>
        </div>
        <div className={styles.cardBd}>
          {insights.length === 0 ? (
            <div className={styles.emptyIcon}>
              <Lightbulb size={40} strokeWidth={1.5} />
              <p className={styles.emptyText}>
                No rules triggered right now. This tab surfaces things like stalled
                villas, top delay reasons, day-of-week manpower gaps, RERA-breach
                risks, and stuck inspections. Cards will appear when patterns
                cross their thresholds.
              </p>
            </div>
          ) : (
            <div className={styles.insightGrid}>
              {insights.map((i) => (
                <InsightCard key={i.id} insight={i} projectId={projectId} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Kept the older trend chart as the second panel — same info surface. */}
      <div className={styles.card}>
        <div className={styles.cardHd}>
          <span>Activity Trend</span>
          <span className={styles.cardMeta}>labour vs progress vs hindrance · rolling window</span>
        </div>
        <div className={styles.cardBd}>
          <InsightsPanels projectId={projectId} />
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight, projectId }: { insight: Insight; projectId: string }) {
  const severityCls = insight.severity === "critical"
    ? styles.sevCritical
    : insight.severity === "warning"
    ? styles.sevWarning
    : styles.sevInfo;

  const linkHref = (() => {
    if (insight.linkHref) return `/projects/${projectId}/${insight.linkHref}`;
    if (insight.affectedVillas && insight.affectedVillas.length > 0) {
      // Deep-link to the first affected villa's drill-in drawer.
      return `/projects/${projectId}/overview?vn=${insight.affectedVillas[0]}`;
    }
    return null;
  })();

  const linkLabel = insight.linkLabel ?? (insight.affectedVillas?.length ? "Open first villa" : null);

  return (
    <div className={`${styles.insight} ${severityCls}`}>
      <div className={styles.insightIcon}>
        <SeverityIcon severity={insight.severity} />
      </div>
      <div className={styles.insightBody}>
        <div className={styles.insightTitle}>{insight.title}</div>
        <div className={styles.insightDetail}>{insight.detail}</div>
        <div className={styles.insightFooter}>
          {insight.metric && (
            <span className={styles.insightMetric}>
              <b>{insight.metric.value}</b>
              <span>{insight.metric.label}</span>
            </span>
          )}
          {insight.affectedVillas && insight.affectedVillas.length > 0 && (
            <span className={styles.insightVillas}>
              {insight.affectedVillas.slice(0, 8).map((n) => `V${n}`).join(" · ")}
              {insight.affectedVillas.length > 8 && ` +${insight.affectedVillas.length - 8}`}
            </span>
          )}
          {linkHref && linkLabel && (
            <Link href={linkHref} className={styles.insightLink} scroll={false}>
              {linkLabel}
              <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: InsightSeverity }) {
  if (severity === "critical") return <Zap size={18} />;
  if (severity === "warning") return <AlertTriangle size={18} />;
  return <Info size={18} />;
}
