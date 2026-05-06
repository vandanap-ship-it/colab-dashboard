import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeMobile } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import BrandMark from "@/components/BrandMark";
import MobileBottomNav from "@/components/MobileBottomNav";

export default async function MobileProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/mobile");
  if (!canSeeMobile(session.user.role)) redirect("/");

  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <header className="border-b border-stone-200 bg-white/90 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 h-12 gap-3">
          <BrandMark href="/mobile" showWordmark={false} />
          <div className="flex-1 min-w-0 text-center">
            <span className="text-sm font-semibold text-stone-900 tracking-tight truncate block">
              {project.name}
            </span>
          </div>
          <span className="text-[11px] text-stone-500 truncate max-w-[80px]">
            {session.user.name?.split(" ")[0] ?? session.user.username}
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      <div
        className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-white border-t border-stone-200"
        style={{ boxShadow: "0 -2px 8px rgba(28, 25, 23, 0.04)" }}
      >
        <MobileBottomNav projectId={project.id} />
      </div>
    </div>
  );
}
