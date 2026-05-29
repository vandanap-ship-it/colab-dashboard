import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { canSeeDesktop, canApproveExpense, canLogExpense, isAdmin } from "@/lib/roles";
import { isScopedUser } from "@/lib/modules";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/Navbar";
import ExpensesManager from "@/components/ExpensesManager";

export default async function ExpensesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");
  const { id: projectId } = await params;
  // Internal-only: scoped contractors never reach the desktop, but guard anyway.
  if (isScopedUser(session.user.modules) || !canLogExpense(session.user.role)) {
    redirect(`/projects/${projectId}/snapshot`);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true },
  });
  if (!project) notFound();

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link
            href={`/projects/${project.id}/snapshot`}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to {project.name}
          </Link>
          <div className="flex items-baseline gap-3 mt-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight inline-flex items-center gap-2">
              <Wallet className="w-5 h-5 text-stone-500" />
              Project Expenses
            </h1>
            {project.code && (
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                {project.code}
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500 mt-1">
            Log and approve site expenses, reimbursements, and purchases. Amounts are tracked
            here for review; the app never moves money.
          </p>
        </div>

        <ExpensesManager
          projectId={project.id}
          canApprove={canApproveExpense(session.user.role)}
          currentUserId={session.user.id}
          isAdmin={isAdmin(session.user.role)}
        />
      </main>
    </div>
  );
}
