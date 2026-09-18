/**
 * Shared mobile UI primitives — the Amanvana-native visual language in
 * one place so every mobile screen looks like the same product.
 *
 *   ScreenHeading  · Fraunces H1 + optional lede for every /mobile/* screen
 *   SectionEyebrow · ferrous small-caps section marker
 *   Step           · numbered ferrous chip + step label (used in flows)
 *   Card           · uniform cream card ground with hairline sandstone border
 *   FieldLabel     · consistent field label styling above inputs
 *
 * When a mobile screen wants "the same layout as everywhere else", it
 * reaches for these. Anything hand-rolled inline drifts within a release
 * and the "muscle memory" pledge breaks.
 */

import type { ReactNode } from "react";

export function ScreenHeading({
  title,
  lede,
}: {
  title: string;
  /** One short sentence under the title. Say what the screen is for in
   *  plain language ("Three steps: pick, drag, save"), not what button
   *  to press. Optional but recommended. */
  lede?: string;
}) {
  return (
    <header className="mb-5">
      <h1 className="font-serif text-[28px] leading-[1.1] text-ink tracking-tight">
        {title}
      </h1>
      {lede && <p className="text-[13px] text-ink-3 mt-1.5 leading-snug">{lede}</p>}
    </header>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold text-ink-3 uppercase tracking-[0.16em] mb-3">
      {children}
    </p>
  );
}

export function Step({ number, label }: { number: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ferrous-500 text-white text-[12px] font-bold font-serif">
        {number}
      </span>
      <span className="text-[15px] font-semibold text-ink">{label}</span>
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  /** Set false when the child needs to hug the card edge (e.g. a list
   *  with row dividers). */
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-cream border border-sandstone-100 shadow-soft ${
        padded ? "p-4" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function FieldLabel({
  children,
  hint,
  optional,
}: {
  children: ReactNode;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div className="mb-2">
      <span className="text-[13px] font-semibold text-ink">
        {children}
        {optional && <span className="text-ink-3 font-normal"> (optional)</span>}
      </span>
      {hint && <p className="text-[12px] text-ink-3 mt-0.5 leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * Consistent primary submit button for mobile forms. Ink pill, cream
 * text, subtle shadow — reads as the final action in a flow.
 */
export function PrimaryAction({
  children,
  disabled,
  onClick,
  type = "submit",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-full bg-ink text-cream py-4 text-[16px] font-semibold shadow-card disabled:opacity-60 active:scale-[0.99]"
    >
      {children}
    </button>
  );
}
