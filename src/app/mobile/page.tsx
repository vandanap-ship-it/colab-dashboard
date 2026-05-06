import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeMobile } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import BrandMark from "@/components/BrandMark";

const STATUS_PILL: Record<string, { dot: string; text: string; label: string }> = {
  PLANNING: { dot: "bg-amber-500", text: "text-amber-700", label: "Planning" },
  ACTIVE: { dot: "bg-emerald-500", text: "text-emerald-700", label: "Active" },
  ON_HOLD: { dot: "bg-stone-500", text: "text-stone-600", label: "On hold" },
  COMPLETED: { dot: "bg-blue-500", text: "text-blue-700", label: "Completed" },
};

export default async function MobileHome() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/mobile");
  if (!canSeeMobile(session.user.role)) redirect("/");

  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, code: true, status: true },
  });

  // Auto-pick if exactly one project
  if (projects.length === 1) redirect(`/mobile/${projects[0].id}`);

  return (
    <div className="flex flex-col flex-1">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between px-4 h-12">
          <BrandMark />
          <span className="text-xs text-stone-500">{session.user.name}</span>
        </div>
      </header>
      <div className="px-4 py-6 space-y-4 flex-1 overflow-y-auto">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 tracking-tight">
            Pick a project
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Select the site you&apos;re logging against.
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-stone-300 bg-white/40 p-8 text-center">
            <Building2 className="w-8 h-8 text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-stone-700">No projects yet</p>
            <p className="text-xs text-stone-500 mt-1">Ask a planner to create one.</p>
          </div>
        ) : (
          <ul className="grid gap-2.5">
            {projects.map((p) => {
              const status = STATUS_PILL[p.status] ?? STATUS_PILL.PLANNING;
              return (
                <li key={p.id}>
                  <Link
                    href={`/mobile/${p.id}`}
                    className="group block rounded-xl border border-stone-200 bg-white p-4 hover:border-stone-300 hover:shadow-soft active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500 shrink-0 group-hover:bg-brand-50 group-hover:text-brand-700 transition-colors">
                        <Building2 className="w-5 h-5" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-stone-900 truncate">
                            {p.name}
                          </span>
                          {p.code && (
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {p.code}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] mt-1 inline-flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          <span className={status.text}>{status.label}</span>
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-900 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
