import { prisma } from "@/lib/prisma";
import RestoreButton from "./RestoreButton";

// Force dynamic rendering — this page hits the DB across six tables to surface
// soft-deleted rows. Pre-rendering it at build time means the build worker
// opens a Postgres connection just to seed an empty cache, which times out on
// Vercel's build sandbox (>60s) and kills the deploy. Render on demand instead.
export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TrashPage() {
  // Each model has its own findMany — we pass an explicit deletedAt filter so
  // the soft-delete extension lets the query through and returns trashed rows.
  const [progress, issues, hindrances, concerns, inspections, projects] =
    await Promise.all([
      prisma.progressEntry.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        include: {
          wbsNode: { select: { name: true, taskCode: true } },
          createdBy: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.issue.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        include: {
          createdBy: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.hindrance.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        include: {
          createdBy: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.concern.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        include: {
          raisedBy: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.inspection.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 100,
        include: {
          filledBy: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.project.findMany({ select: { id: true, name: true } }),
    ]);

  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const total =
    progress.length + issues.length + hindrances.length + concerns.length + inspections.length;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Trash</h1>
          <p className="text-sm text-stone-500 mt-1">
            Soft-deleted records. Restore them with one click. Nothing here is permanently gone.
          </p>
        </div>
        <div className="text-xs text-stone-500">
          <span className="font-medium text-stone-900">{total}</span> in trash
        </div>
      </div>

      {total === 0 ? (
        <div className="bg-white border border-dashed border-stone-300 rounded-lg p-10 text-center text-sm text-stone-500">
          Nothing deleted yet. When something is deleted from the app, it shows up here for admin review.
        </div>
      ) : (
        <>
          <Section
            title="Progress entries"
            items={progress.map((p) => ({
              id: p.id,
              entityType: "ProgressEntry" as const,
              projectName: projectName.get(p.projectId) ?? "—",
              when: p.deletedAt,
              who: p.createdBy?.name ?? "—",
              line:
                `${p.wbsNode?.name ?? "Activity"}` +
                (p.notes ? ` · ${p.notes.slice(0, 60)}` : "") +
                (p.cumulativeQuantity ? ` · cumulative ${p.cumulativeQuantity}` : ""),
            }))}
          />

          <Section
            title="Snags"
            items={issues.map((i) => ({
              id: i.id,
              entityType: "Issue" as const,
              projectName: projectName.get(i.projectId) ?? "—",
              when: i.deletedAt,
              who: i.createdBy?.name ?? "—",
              line: i.description.slice(0, 100),
            }))}
          />

          <Section
            title="Hindrances"
            items={hindrances.map((h) => ({
              id: h.id,
              entityType: "Hindrance" as const,
              projectName: projectName.get(h.projectId) ?? "—",
              when: h.deletedAt,
              who: h.createdBy?.name ?? "—",
              line: h.description.slice(0, 100),
            }))}
          />

          <Section
            title="Concerns"
            items={concerns.map((c) => ({
              id: c.id,
              entityType: "Concern" as const,
              projectName: projectName.get(c.projectId) ?? "—",
              when: c.deletedAt,
              who: c.raisedBy?.name ?? "—",
              line: c.description.slice(0, 100),
            }))}
          />

          <Section
            title="Inspections"
            items={inspections.map((s) => ({
              id: s.id,
              entityType: "Inspection" as const,
              projectName: projectName.get(s.projectId) ?? "—",
              when: s.deletedAt,
              who: s.filledBy?.name ?? "—",
              line: s.title,
            }))}
          />
        </>
      )}
    </div>
  );

  function Section({
    title,
    items,
  }: {
    title: string;
    items: Array<{
      id: string;
      entityType: "ProgressEntry" | "Issue" | "Hindrance" | "Concern" | "Inspection";
      projectName: string;
      when: Date | null | undefined;
      who: string;
      line: string;
    }>;
  }) {
    if (items.length === 0) return null;
    return (
      <section className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <header className="bg-stone-50 border-b border-stone-200 px-4 py-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
          <span className="text-[10px] uppercase tracking-wider text-stone-500">
            {items.length}
          </span>
        </header>
        <ul className="divide-y divide-stone-100">
          {items.map((item) => (
            <li
              key={item.id}
              className="px-4 py-3 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-stone-900 truncate">{item.line}</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  {item.projectName} · deleted {fmtDate(item.when)} · by {item.who}
                </p>
              </div>
              <RestoreButton entityType={item.entityType} id={item.id} />
            </li>
          ))}
        </ul>
      </section>
    );
  }
}
