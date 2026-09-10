import { CheckCircle2 } from "lucide-react";

/**
 * Consistent "positive empty state" for the Snapshot summary cards
 * (Hindrances / Snags / Areas of Concern). Previously each card had a
 * different treatment — one shouted "NO HINDRANCE REGISTERED" in giant
 * grey caps, another said "No open snags." in fine print, the third
 * "No concerns in this status." — so the same "empty" state read as
 * "something wrong" on one card and "nothing to see" on another.
 *
 * This normalises to a friendly one-line checkmark card with an
 * optional detail line, so an empty section reads as "clean site" not
 * "the app is broken".
 */
export default function EmptyAllClear({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-emerald-50/60 border border-emerald-100 px-4 py-3">
      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" strokeWidth={2} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-emerald-900">{title}</p>
        {detail && <p className="text-xs text-emerald-700 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}
