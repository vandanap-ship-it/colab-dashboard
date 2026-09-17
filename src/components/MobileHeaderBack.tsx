"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import BrandMark from "./BrandMark";

/**
 * Top-left slot of the mobile header. Renders BrandMark on the project home
 * (`/mobile/[projectId]`), and a Back arrow → `router.back()` on any subpage.
 *
 * Why a client component: only the browser knows the route history and the
 * current path, and we need `router.back()` for the back gesture rather than
 * a hard-coded `/mobile/[projectId]` link — an engineer deep-linking from an
 * inspection detail should return to the QA/QC list, not the mobile home.
 */
export default function MobileHeaderBack({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const isHome = pathname === `/mobile/${projectId}` || pathname === `/mobile/${projectId}/`;
  if (isHome) return <BrandMark href="/mobile" showWordmark={false} />;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Back"
      className="w-8 h-8 rounded-full flex items-center justify-center text-stone-900 active:bg-stone-100"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
}
