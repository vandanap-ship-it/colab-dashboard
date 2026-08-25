import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";

export const dynamic = "force-dynamic";

export default async function LogicReferencePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            All projects
          </Link>
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-600 mt-3">Reference</p>
          <h1 className="text-3xl font-semibold text-stone-900 tracking-tight mt-1">
            How every number on Siddhi is computed
          </h1>
          <p className="text-sm text-stone-500 mt-2 max-w-2xl">
            Every metric on the Dashboard, Progress, QA/QC, Safety, Insights, and
            reports pages comes from one of the formulas below. If a number
            surprises you, look it up here — no black boxes.
          </p>
        </div>

        <TOC />

        <Section id="projected-date" title="Projected Handover Date">
          <Formula>
            <code>projectedHandover = baselineEnd + totalDelayDays</code>
          </Formula>
          <p>
            <strong>Baseline end</strong> comes from the imported MSP schedule.{" "}
            <strong>Total delay days</strong> is the maximum slip across active blocks.
          </p>
          <Example>
            Amanvana Phase 1 baseline end = 22 Feb 2029.<br />
            Worst active block (Block 10) is +74 days late. Projected handover = 22 Feb 2029 + 74 days = 07 May 2029.
          </Example>
        </Section>

        <Section id="total-delay" title="Total Delay Days">
          <Formula>
            <code>totalDelayDays = max(slipDays across all active blocks)</code>
          </Formula>
          <p>
            The <em>worst</em> active block sets the number — the project can&apos;t finish
            faster than its slowest handoverable block. Blocks marked{" "}
            <code>active: false</code> (not started yet) are excluded.
          </p>
          <p>
            Alternatives we considered but rejected: weighted-average across villas
            (masks the critical path), 90th-percentile villa (hides tail risk).
          </p>
        </Section>

        <Section id="physical-progress" title="Physical Progress %">
          <Formula>
            <code>achievedPct = sum(taskDurationDays × taskPctComplete) / sum(taskDurationDays)</code>
          </Formula>
          <p>
            Duration-weighted average of every task&apos;s % complete. A 60-day task at
            50% counts 6× more than a 10-day task at 50%.
          </p>
          <p>
            <strong>Planned %</strong> uses the same formula but with{" "}
            <code>plannedPctByToday</code> instead of achieved — the % of each task
            that <em>should</em> be done by today if the baseline were being met.
          </p>
        </Section>

        <Section id="probability" title="Probability of Timely Completion (Green / Orange / Red)">
          <Formula>
            <ul>
              <li><strong>High (green)</strong> when projected handover ≤ RERA end date</li>
              <li><strong>Medium (orange)</strong> when projected handover is 1–15 days past RERA</li>
              <li><strong>Low (red)</strong> when projected handover is more than 15 days past RERA</li>
            </ul>
          </Formula>
          <p>
            RERA is the regulator&apos;s committed date. The 15-day cushion accounts
            for typical monsoon and final-fit-out variance in villa projects.
          </p>
        </Section>

        <Section id="villa-status" title="Villa Status (Healthy / Warning / Critical / Not Started)">
          <Formula>
            <ul>
              <li><strong>Not Started</strong> — no villa milestone has actualStart yet</li>
              <li><strong>Healthy</strong> — slip ≤ 7 days</li>
              <li><strong>Warning</strong> — slip 8–30 days</li>
              <li><strong>Critical</strong> — slip &gt; 30 days</li>
            </ul>
          </Formula>
          <p>
            <strong>Villa slip</strong> = max slip across all milestone sections for that villa.
            Slip = <code>projectedFinish − baselineFinish</code>, capped at 0 (a villa
            can&apos;t be &quot;negatively delayed&quot; — an early finish shows as 0d slip).
          </p>
        </Section>

        <Section id="block-status" title="Block Status">
          <Formula>
            <code>blockSlip = max(villaSlip across villas in that block)</code>
          </Formula>
          <p>
            Same Healthy / Warning / Critical thresholds as villas (7d / 30d). This
            is why one bad villa can flip a whole block red — that&apos;s intentional,
            since a shared handover date drops when one villa is late.
          </p>
        </Section>

        <Section id="milestone-progress" title="Milestone Progress table (line items due / done / pending)">
          <Formula>
            <ul>
              <li><strong>Line items due</strong> = villa milestones whose <code>baselineFinish ≤ today</code></li>
              <li><strong>Done</strong> = of those, how many have <code>actualFinish</code> set</li>
              <li><strong>Pending</strong> = due − done</li>
              <li><strong>Status</strong>: &quot;Not started&quot; if due = 0; &quot;All done&quot; if pending = 0; &quot;N pending&quot; otherwise</li>
            </ul>
          </Formula>
          <p>
            The scorecard PDF shows &quot;pending&quot; in red because those are line items
            that should have finished by now but haven&apos;t.
          </p>
        </Section>

        <Section id="delay-reasons" title="Delay Reason Clusters (Dashboard + Reports)">
          <Formula>
            <p>Group all OPEN hindrances by <code>reasonCode</code>, then per cluster:</p>
            <ul>
              <li><strong>Count</strong> = number of open hindrances with that reason</li>
              <li><strong>Days impact</strong> = sum of <code>daysImpact</code> across those hindrances</li>
              <li><strong>Affected villas</strong> = distinct villas via <code>wbsNode.villaId</code></li>
              <li><strong>Mitigation text</strong> = fixed template per reason code (see <code>src/lib/reasonMitigations.ts</code>)</li>
            </ul>
          </Formula>
          <p>
            Untagged hindrances fold into a &quot;Unspecified&quot; bucket — they still surface
            so no data is hidden. Site engineers pick the reason from the mobile
            hindrance form when logging.
          </p>
        </Section>

        <Section id="manpower" title="Manpower — Planned vs Actual, % of Plan, Safe Man-Hours">
          <Formula>
            <ul>
              <li><strong>Planned per day</strong> = sum of <code>plannedCount</code> across all effective TradePlans for that day</li>
              <li><strong>Actual per day</strong> = sum of <code>actualCount</code> across ManpowerEntry rows for that day</li>
              <li><strong>% of plan</strong> = round(actual / planned × 100), null if planned = 0</li>
              <li><strong>Safe Man-Hours</strong> = sum(actualCount × 8) since the last LTI (or project start if none)</li>
            </ul>
          </Formula>
          <p>
            Trade plans are effective from <code>startDate</code> until <code>endDate</code>{" "}
            (endDate NULL = still current). If two plans overlap on a day, the one
            with the latest startDate wins — most recent decision is authoritative.
          </p>
        </Section>

        <Section id="tat" title="Turnaround Time (TAT)">
          <Formula>
            <ul>
              <li><strong>Inspection TAT</strong> = days from <code>createdAt</code> to <code>reviewedAt</code>, averaged over closed inspections</li>
              <li><strong>Submission TAT (Issues)</strong> = days from open → resolved, averaged over closed issues</li>
              <li><strong>30-day rolling TAT</strong> (Insights) = per-day avg TAT for inspections closed on that day; used to spot &quot;improving / worsening&quot; trends</li>
            </ul>
          </Formula>
        </Section>

        <Section id="insights" title="Insight Rules (the 7 smart callouts)">
          <Formula>
            <p>Each rule runs on page load; a card appears only if the threshold is crossed.</p>
            <ol className="mt-2 space-y-1">
              <li>1. <strong>stalled-block</strong>: ≥ 3 villas in a block without a progress entry for &gt; 7 days. Critical at ≥ 5.</li>
              <li>2. <strong>top-delay-reason</strong>: single reason code driving the most days across ≥ 3 hindrances. Critical if aggregate ≥ 30 days.</li>
              <li>3. <strong>day-of-week-shortfall</strong>: a weekday where actual manpower fell below plan on ≥ 75% of ≥ 3 recent samples.</li>
              <li>4. <strong>rera-breach</strong>: any villa whose final projected finish exceeds the project&apos;s RERA end date. Critical if breach ≥ 60 days.</li>
              <li>5. <strong>low-coverage</strong>: ≥ 3 of the last 7 days where progress-entry-updated villas &lt; 25% of active villas. Critical at ≥ 5.</li>
              <li>6. <strong>milestone-lag</strong>: consecutive sections where the earlier is ≥ 50% complete but the next is ≥ 40 pp behind — flags stage-transition bottlenecks.</li>
              <li>7. <strong>stuck-inspections</strong>: ≥ 3 inspections in review for &gt; 3 days. Critical at ≥ 10.</li>
            </ol>
          </Formula>
          <p>
            Rules live in <code>src/lib/insightsServer.ts</code>. Change a threshold there and
            it takes effect on the next page load — no rebuild required.
          </p>
        </Section>

        <div className="pt-6 border-t border-stone-200 text-xs text-stone-500">
          <p>
            If you find a number that doesn&apos;t match a formula here, that&apos;s a bug — file
            it. This page is the single source of truth; the code and the reports
            follow it.
          </p>
        </div>
      </main>
    </div>
  );
}

function TOC() {
  const items: [string, string][] = [
    ["projected-date", "Projected Handover Date"],
    ["total-delay", "Total Delay Days"],
    ["physical-progress", "Physical Progress %"],
    ["probability", "Probability (Green / Orange / Red)"],
    ["villa-status", "Villa Status"],
    ["block-status", "Block Status"],
    ["milestone-progress", "Milestone Progress table"],
    ["delay-reasons", "Delay Reason Clusters"],
    ["manpower", "Manpower + Safe Man-Hours"],
    ["tat", "Turnaround Time"],
    ["insights", "Insight rules"],
  ];
  return (
    <nav className="rounded-xl border border-stone-200 bg-white px-5 py-4">
      <div className="text-[10px] font-semibold text-stone-600 uppercase tracking-[0.14em] mb-3">
        Contents
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {items.map(([anchor, label]) => (
          <li key={anchor}>
            <a href={`#${anchor}`} className="text-stone-700 hover:text-amber-700 transition-colors">
              → {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-stone-200 bg-white p-6 space-y-3 scroll-mt-6">
      <h2 className="text-lg font-semibold text-stone-900 tracking-tight">{title}</h2>
      <div className="text-sm text-stone-700 leading-relaxed space-y-3 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:bg-stone-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded">
        {children}
      </div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-stone-50 border-l-3 border-amber-500 px-4 py-3 text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      {children}
    </div>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-stone-800">
      <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-[0.14em] mb-1.5">
        Example
      </div>
      {children}
    </div>
  );
}
