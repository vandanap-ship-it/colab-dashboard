import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ projectId: string; wbsId: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { projectId, wbsId } = await params;

  const node = await prisma.wBSNode.findFirst({
    where: { id: wbsId, projectId },
    include: { contractor: { select: { name: true, category: true } } },
  });
  if (!node) notFound();

  const all = await prisma.wBSNode.findMany({
    where: { projectId },
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(all.map((n) => [n.id, n]));
  const path: string[] = [];
  let cur: { id: string; name: string; parentId: string | null } | undefined = byId.get(node.id);
  while (cur) {
    path.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  const recent = await prisma.progressEntry.findMany({
    where: { wbsNodeId: wbsId },
    orderBy: { date: "desc" },
    take: 10,
    include: {
      createdBy: { select: { name: true } },
      contractor: { select: { name: true } },
      labour: true,
      photos: true,
    },
  });

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <Link href={`/mobile/${projectId}/site-progress`} className="text-sm text-stone-500">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold text-stone-900 mt-1">{node.name}</h1>
        <p className="text-[10px] text-stone-500 mt-0.5">ID: {node.taskCode}</p>
        <p className="text-xs text-stone-500 mt-1">{path.slice(0, -1).join(" / ")}</p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-stone-500">Planned Start</div>
          <div className="font-medium">{fmt(node.baselineStart)}</div>
        </div>
        <div className="text-right">
          <div className="text-stone-500">Planned End</div>
          <div className="font-medium">{fmt(node.baselineFinish)}</div>
        </div>
        <div>
          <div className="text-stone-500">Actual Start</div>
          <div className="font-medium">{fmt(node.actualStart)}</div>
        </div>
        <div className="text-right">
          <div className="text-stone-500">Projected End</div>
          <div className="font-medium">{fmt(node.projectedFinish)}</div>
        </div>
        <div className="col-span-2 pt-2 border-t border-stone-100">
          <div className="text-stone-500">Progress</div>
          <div className="text-2xl font-semibold text-stone-900">
            {Math.round(node.percentComplete)}%
          </div>
          {node.totalQuantity != null && (
            <div className="text-[10px] text-stone-500 mt-1">
              Total: {node.totalQuantity} {node.unit ?? "UNIT"}
            </div>
          )}
        </div>
        {node.contractor && (
          <div className="col-span-2 text-[10px] text-stone-500">
            Contractor: <span className="text-stone-900 font-medium">{node.contractor.name}</span>{" "}
            ({node.contractor.category})
          </div>
        )}
      </div>

      <Link
        href={`/mobile/${projectId}/progress/new?activityId=${node.id}`}
        className="block w-full text-center rounded-full bg-stone-900 text-white py-3 text-sm font-medium"
      >
        + Log progress for this activity
      </Link>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
          Recent entries
        </h2>
        {recent.length === 0 ? (
          <p className="text-xs text-stone-500">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-stone-200 bg-white p-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-stone-900">
                    {fmt(e.date)} · {e.cumulativeQuantity}{" "}
                    {node.unit ?? ""}
                  </div>
                  <div className="text-stone-500">{e.createdBy.name}</div>
                </div>
                {e.contractor && <div className="text-stone-500 mt-1">{e.contractor.name}</div>}
                {e.labour.length > 0 && (
                  <div className="text-stone-500 mt-1">
                    {e.labour.map((l) => `${l.category} × ${l.count}`).join(", ")}
                  </div>
                )}
                {e.notes && <p className="mt-1 text-stone-700">{e.notes}</p>}
                {e.photos.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {e.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.url} alt="" className="h-14 w-14 rounded object-cover" />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
