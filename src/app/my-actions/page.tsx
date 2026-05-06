import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeDesktop } from "@/lib/roles";
import Navbar from "@/components/Navbar";
import MyActions from "@/components/MyActions";

export default async function MyActionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/my-actions");
  if (!canSeeDesktop(session.user.role)) redirect("/mobile");

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-10">
        <MyActions />
      </main>
    </div>
  );
}
