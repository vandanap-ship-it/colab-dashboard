import { CheckCircle2, Clock, X } from "lucide-react";

/** PENDING / APPROVED / REJECTED pill for register sign-offs. */
export default function SubmissionStatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; Icon: typeof Clock }> = {
    PENDING: { cls: "bg-amber-50 ring-amber-200 text-amber-800", label: "Pending", Icon: Clock },
    APPROVED: { cls: "bg-emerald-50 ring-emerald-200 text-emerald-800", label: "Approved", Icon: CheckCircle2 },
    REJECTED: { cls: "bg-red-50 ring-red-200 text-red-800", label: "Rejected", Icon: X },
  };
  const cfg = map[status] ?? map.PENDING;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-semibold shrink-0 ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
