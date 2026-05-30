/**
 * A bright "STAGING" strip rendered at the very top of every page when
 * NEXT_PUBLIC_ENV is set to "staging". The whole point is to make it
 * physically impossible to mistake the staging app for production.
 *
 * On production (NEXT_PUBLIC_ENV unset or anything else), it renders nothing.
 */
export default function StagingBanner() {
  if (process.env.NEXT_PUBLIC_ENV !== "staging") return null;
  return (
    <div className="bg-amber-500 text-white text-center py-1.5 text-[11px] font-semibold tracking-[0.25em] uppercase print:hidden">
      Staging environment · not your live data
    </div>
  );
}
