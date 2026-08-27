import Link from "next/link";

/**
 * Rendered in place of a report when the aggregator throws. The reports MUST
 * NOT 500 the whole page in front of the manager — a labelled fallback lets
 * Shraddha see there was a problem, keep working on the other report, and
 * ping engineering with a copy-pasteable detail line.
 */
export default function ReportErrorFallback({
  title,
  detail,
  projectId,
}: {
  title: string;
  detail: string;
  projectId: string;
}) {
  return (
    <div style={{
      maxWidth: 720,
      margin: "80px auto",
      padding: "32px 28px",
      border: "1px solid #E7E1D4",
      borderRadius: 6,
      background: "#FFF9EE",
      color: "#4E5866",
      fontFamily: "system-ui, sans-serif",
      lineHeight: 1.5,
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#16202F" }}>{title}</h1>
      <p style={{ marginTop: 12, fontSize: 14 }}>
        Something went wrong assembling this report. This is a bug — please
        ping the engineer with the detail below.
      </p>
      <pre style={{
        marginTop: 16,
        padding: 12,
        background: "#F5EFDF",
        border: "1px solid #E7E1D4",
        borderRadius: 4,
        fontSize: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "#7A5A00",
      }}>{detail}</pre>
      <p style={{ marginTop: 20, fontSize: 13 }}>
        In the meantime, you can still open{" "}
        <Link href={`/projects/${projectId}/overview`} style={{ color: "#2E5FA9", textDecoration: "underline" }}>
          the project dashboard
        </Link>{" "}
        or{" "}
        <Link href="/" style={{ color: "#2E5FA9", textDecoration: "underline" }}>
          the projects list
        </Link>.
      </p>
    </div>
  );
}
