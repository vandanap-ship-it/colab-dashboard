import {
  dueState,
  formatIsoDay,
  type RegisterColumn,
  type RegisterValues,
} from "@/lib/registers";

/**
 * The register laid out exactly like the safety team's Excel sheet:
 * S.No + one column per register column, in order. Used on the submit
 * review screen, the sign-off detail and the print view, so what the
 * maker reviews is what the approver signs is what gets printed.
 *
 * Server-safe (no hooks). On screens it scrolls sideways inside its own
 * box so the page never scrolls horizontally on a phone.
 */
export default function RegisterTable({
  columns,
  rows,
  dueDateKey,
  todayIso,
  variant = "screen",
  villaColumnKey = "location",
  identifierKey,
}: {
  columns: RegisterColumn[];
  rows: Array<{ id: string; identifier: string; values: RegisterValues; villaLabel: string | null }>;
  /** When set with todayIso, overdue / due-soon cells are tinted on screen. */
  dueDateKey?: string | null;
  todayIso?: string;
  variant?: "screen" | "print";
  /** Column whose cell gets the optional villa tag appended, e.g. "Store (Villa 12)". */
  villaColumnKey?: string;
  /** Identifier column — kept on one line. Defaults to the first column. */
  identifierKey?: string;
}) {
  const idKey = identifierKey ?? columns[0]?.key;
  const print = variant === "print";
  const cell = print
    ? "border border-black px-2 py-1.5 align-top text-[11px] leading-snug"
    : "border-b border-stone-200 px-3 py-2 align-top text-[12px] leading-snug";
  const head = print
    ? "border border-black px-2 py-1.5 text-left text-[11px] font-bold align-bottom bg-stone-100"
    : "border-b-2 border-stone-300 px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-stone-500 align-bottom whitespace-nowrap";

  const table = (
    <table className={print ? "w-full border-collapse" : "min-w-full border-collapse"}>
      <thead>
        <tr>
          <th className={`${head} w-10`}>S.No</th>
          {columns.map((c) => (
            <th key={c.key} className={head}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td className={cell} colSpan={columns.length + 1}>
              <span className="text-stone-500">No items.</span>
            </td>
          </tr>
        )}
        {rows.map((r, i) => {
          const state =
            !print && dueDateKey && todayIso ? dueState(r.values[dueDateKey], todayIso) : "none";
          return (
            <tr key={r.id} className={state === "overdue" ? "bg-red-50" : undefined}>
              <td className={`${cell} tabular-nums`}>{i + 1}</td>
              {columns.map((c) => {
                const raw = r.values[c.key] ?? "";
                let text = c.kind === "date" ? formatIsoDay(raw) : raw || "—";
                if (c.key === villaColumnKey && r.villaLabel) text = `${text} (${r.villaLabel})`;
                const tint =
                  c.key === dueDateKey && state === "overdue"
                    ? " text-red-700 font-semibold"
                    : c.key === dueDateKey && state === "due_soon"
                      ? " text-amber-700 font-semibold"
                      : "";
                return (
                  <td
                    key={c.key}
                    className={`${cell}${c.kind === "date" ? " whitespace-nowrap tabular-nums" : !print && c.key !== idKey ? " min-w-[9rem]" : " whitespace-nowrap"}${tint}`}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  if (print) return table;
  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-x-auto">{table}</div>
  );
}
