"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Small client-side select that navigates on change while preserving the
 * other filter chips already in the URL. Extracted so the audit-log page
 * itself can stay a Server Component — only the interactive select needs
 * "use client".
 *
 * Behaviour: picking a value pushes /admin/audit?<current qs, paramKey
 * updated>. Picking "All …" (value === "") deletes paramKey from the qs.
 * Nothing else in the qs is touched, so an entity/action chip filter set
 * elsewhere survives the switch.
 */
export default function FilterSelect({
  paramKey,
  currentValue,
  allLabel,
  options,
}: {
  paramKey: string;
  currentValue: string | null | undefined;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const qs = new URLSearchParams(searchParams.toString());
    if (next) qs.set(paramKey, next);
    else qs.delete(paramKey);
    const suffix = qs.toString();
    router.push(suffix ? `${pathname}?${suffix}` : pathname);
  }

  return (
    <select
      className="text-xs border border-stone-300 rounded-md px-2 py-1 bg-white"
      value={currentValue ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
