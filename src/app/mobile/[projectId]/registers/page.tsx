import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FireExtinguisher } from "lucide-react";
import { auth } from "@/lib/auth";
import { canAccessModule, type ModuleKey } from "@/lib/modules";
import { listRegisterTypes } from "@/lib/registersServer";

export const dynamic = "force-dynamic";

/**
 * Registers hub — one card per register type the user can see. With a
 * single type (fire extinguishers today) it goes straight to that list so
 * the home tile is one tap, not two.
 */
export default async function MobileRegistersHub({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { projectId } = await params;

  const types = (await listRegisterTypes()).filter((t) =>
    canAccessModule(session.user.modules, t.module as ModuleKey),
  );
  if (types.length === 0) redirect(`/mobile/${projectId}`);
  if (types.length === 1) redirect(`/mobile/${projectId}/registers/${types[0].code}`);

  return (
    <div className="px-4 py-5">
      <h1 className="font-serif text-[28px] leading-tight text-ink tracking-tight mb-4">Registers</h1>
      <ul className="space-y-2.5">
        {types.map((t) => (
          <li key={t.code}>
            <Link
              href={`/mobile/${projectId}/registers/${t.code}`}
              className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white shadow-sm p-4 active:bg-stone-50"
            >
              <FireExtinguisher className="w-5 h-5 text-ferrous-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink">{t.shortName}</p>
                <p className="text-[12px] text-ink-3 truncate">{t.name}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
