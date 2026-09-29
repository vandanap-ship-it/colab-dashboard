/**
 * Beta strip rendered at the top of every desktop page during the initial
 * team handover phase. Sets expectations: this is a real replacement for
 * Colab Tools that is still being built, not a finished product. Prints
 * are unaffected (print:hidden).
 *
 * Disabled by setting NEXT_PUBLIC_BETA=off in Vercel env. Leave unset,
 * or set to anything else, to keep the strip visible.
 */
export default function BetaBanner() {
  if (process.env.NEXT_PUBLIC_BETA === "off") return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-1.5 text-[11px] text-amber-900">
        <span
          className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-white"
        >
          Beta
        </span>
        <span className="tracking-wide">
          Siddhi is live for the site team from today. Flag any issue to
          Shraddha; QAQC / EHS / Progress / DLR flows continue in Colab
          Tools until each rolls out here.
        </span>
      </div>
    </div>
  );
}
