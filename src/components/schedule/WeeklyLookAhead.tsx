import { AlertTriangle, CheckCircle2, Circle, Clock } from "lucide-react";
import type { LookAheadBucket, LookAheadTask } from "@/lib/scheduleServer";

interface Props {
  data: LookAheadBucket;
}

/**
 * Server-rendered look-ahead. Overdue first (loud), then in-progress, then
 * upcoming days. Each task shows its villa + section + contractor so a site
 * engineer can plan the day.
 */
export default function WeeklyLookAhead({ data }: Props) {
  const total =
    data.overdue.length + data.inProgress.length + data.days.reduce((n, d) => n + d.tasks.length, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-10 text-center text-stone-500">
        No tasks in the look-ahead window.
        <p className="text-xs mt-2 text-stone-400">
          Once the MSP schedule is imported, tasks scheduled for the next 2 weeks appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.overdue.length > 0 && (
        <Section
          title="Overdue"
          count={data.overdue.length}
          icon={<AlertTriangle className="w-4 h-4 text-red-700" />}
          accent="border-red-200"
        >
          <ul className="divide-y divide-stone-100">
            {data.overdue.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </Section>
      )}

      {data.inProgress.length > 0 && (
        <Section
          title="In Progress"
          count={data.inProgress.length}
          icon={<Clock className="w-4 h-4 text-blue-700" />}
          accent="border-blue-200"
        >
          <ul className="divide-y divide-stone-100">
            {data.inProgress.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </Section>
      )}

      {data.days.length > 0 && (
        <Section
          title="Upcoming (next 14 days)"
          count={data.days.reduce((n, d) => n + d.tasks.length, 0)}
          icon={<Circle className="w-4 h-4 text-stone-400" />}
        >
          <div className="divide-y divide-stone-100">
            {data.days.map((day) => (
              <div key={day.date}>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-stone-500 bg-stone-50">
                  {day.label}
                  <span className="ml-2 text-stone-400 font-normal">· {day.tasks.length} task{day.tasks.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="divide-y divide-stone-100">
                  {day.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title, count, icon, accent, children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${accent ?? "border-stone-200"}`}>
      <div className="px-4 py-2.5 border-b border-stone-100 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        <span className="text-xs text-stone-500 font-mono">({count})</span>
      </div>
      {children}
    </div>
  );
}

function TaskRow({ task }: { task: LookAheadTask }) {
  const dateLine = task.baselineStart
    ? `${formatDate(task.baselineStart)} → ${formatDate(task.baselineFinish)}`
    : "no baseline";
  return (
    <li className="px-4 py-3 flex items-start gap-3 text-sm hover:bg-stone-50">
      <div className="mt-0.5 shrink-0">
        {task.percentComplete >= 100 ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        ) : task.status === "OVERDUE" ? (
          <AlertTriangle className="w-4 h-4 text-red-700" />
        ) : task.status === "IN_PROGRESS" ? (
          <Clock className="w-4 h-4 text-blue-700" />
        ) : (
          <Circle className="w-4 h-4 text-stone-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {task.isSubMilestone && (
            <span className="inline-block text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">★</span>
          )}
          <span className="text-stone-900 font-medium truncate">{task.name}</span>
        </div>
        <div className="text-xs text-stone-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {task.villaLabel && <span>{task.villaLabel}</span>}
          {task.sectionName && (
            <>
              <span className="text-stone-300">·</span>
              <span>{task.sectionName}</span>
            </>
          )}
          {task.contractorName && (
            <>
              <span className="text-stone-300">·</span>
              <span>{task.contractorName}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right text-xs text-stone-500 whitespace-nowrap shrink-0 font-mono">
        <div>{dateLine}</div>
        {task.status === "OVERDUE" && task.baselineFinish && (
          <div className="text-red-700 font-semibold">
            {Math.abs(daysSince(task.baselineFinish))}d overdue
          </div>
        )}
        {task.status === "DUE_TODAY" && (
          <div className="text-orange-700 font-semibold">starts today</div>
        )}
        {task.status === "UPCOMING" && task.daysUntilStart != null && task.daysUntilStart > 0 && (
          <div className="text-stone-400">in {task.daysUntilStart}d</div>
        )}
        {task.status === "IN_PROGRESS" && (
          <div className="text-blue-700 font-semibold">{task.percentComplete}%</div>
        )}
      </div>
    </li>
  );
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatDate(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}
function daysSince(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / 86_400_000);
}
