import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canSeeMobile } from "@/lib/roles";

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/mobile");
  if (!canSeeMobile(session.user.role)) redirect("/");

  return <div className="flex-1 flex flex-col bg-ivory">{children}</div>;
}
