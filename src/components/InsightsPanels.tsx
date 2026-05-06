"use client";

import { useEffect, useState } from "react";
import MiniBarChart from "./MiniBarChart";

type Bucket = {
  day: string;
  achieved: number;
  labour: number;
  hindranceOpen: number;
  hindranceResolved: number;
};

type Insights = {
  days: number;
  since: string;
  buckets: Bucket[];
  totals: {
    achievedSum: number;
    labourSum: number;
    progressEntries: number;
    hindrancesOpened: number;
    hindrancesResolved: number;
  };
};

export default function InsightsPanels({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/insights?days=${days}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData);
  }, [projectId, days]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Insights</h1>
          <p className="text-sm text-stone-500 mt-1">Last {days} days</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90, 180].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full ${
                days === d ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Progress entries" value={data.totals.progressEntries.toString()} />
            <Stat label="Achieved (qty)" value={data.totals.achievedSum.toFixed(1)} />
            <Stat label="Total labour" value={data.totals.labourSum.toString()} />
            <Stat label="Hindrances opened" value={data.totals.hindrancesOpened.toString()} accent="red" />
            <Stat label="Hindrances resolved" value={data.totals.hindrancesResolved.toString()} accent="emerald" />
          </div>

          <Card title="Achieved quantity per day">
            <MiniBarChart
              color="#0ea5e9"
              data={data.buckets.map((b) => ({ label: b.day, value: b.achieved }))}
            />
          </Card>

          <Card title="Daily labour count">
            <MiniBarChart
              color="#f59e0b"
              data={data.buckets.map((b) => ({ label: b.day, value: b.labour }))}
            />
          </Card>

          <Card title="Hindrances opened per day">
            <MiniBarChart
              color="#ef4444"
              data={data.buckets.map((b) => ({ label: b.day, value: b.hindranceOpen }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "red" | "emerald" }) {
  const tone =
    accent === "red"
      ? "text-red-600"
      : accent === "emerald"
        ? "text-emerald-600"
        : "text-stone-900";
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
    </div>
  );
}
