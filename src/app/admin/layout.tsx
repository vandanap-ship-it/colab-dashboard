import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import Navbar from "@/components/Navbar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/users");
  if (!isAdmin(session.user.role)) redirect("/");

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-[1800px] mx-auto px-8 py-10">{children}</main>
    </div>
  );
}
