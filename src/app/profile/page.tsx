import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import { ROLE_LABELS } from "@/lib/roles";
import { ChangePasswordCard, EditNameCard } from "@/components/ProfileEditForms";

function initials(name: string | null | undefined, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  const name = session.user.name ?? session.user.username;

  return (
    <div className="flex-1 flex flex-col bg-ivory">
      <Navbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Profile</h1>
          <p className="text-sm text-stone-500 mt-1">
            Update your display name or change your password.
          </p>
        </div>

        {/* Identity card */}
        <section className="rounded-2xl border border-stone-200 bg-white p-6 flex items-center gap-5 shadow-soft">
          <span className="w-16 h-16 rounded-full bg-stone-900 text-white flex items-center justify-center text-xl font-semibold ring-4 ring-stone-100">
            {initials(name)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold text-stone-900 truncate">{name}</p>
            <p className="text-sm text-stone-500">@{session.user.username}</p>
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-brand-700 bg-brand-50 ring-1 ring-brand-200 px-2 py-0.5 rounded-full">
              <ShieldCheck className="w-3 h-3" />
              {ROLE_LABELS[role] ?? role}
            </div>
          </div>
        </section>

        <EditNameCard initialName={session.user.name ?? ""} />
        <ChangePasswordCard />

        <p className="text-xs text-stone-400 text-center pt-2">
          Other fields (date of birth, emergency contact, profile picture) ship in v2.
        </p>
      </main>
    </div>
  );
}
