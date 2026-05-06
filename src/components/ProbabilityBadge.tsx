import { probabilityFromDelay } from "@/lib/probability";

export default function ProbabilityBadge({
  delayDays,
  size = "sm",
}: {
  delayDays: number | null | undefined;
  size?: "xs" | "sm";
}) {
  const info = probabilityFromDelay(delayDays);
  const sizeCls =
    size === "xs"
      ? "text-[10px] px-2 py-0.5"
      : "text-[11px] px-2.5 py-0.5";
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-full ${sizeCls} ${info.pillClass}`}
      title={`Total delay: ${delayDays ?? 0} days`}
    >
      {info.label}
    </span>
  );
}
