import Link from "next/link";

/**
 * Shown at the top of an executive dashboard tab when the project hasn't had
 * its MSP schedule imported yet. Data below the banner is placeholder mock
 * (from src/lib/executiveMockData.ts) so the layout is legible while the real
 * numbers are missing.
 */
export function PlaceholderBanner({ projectId }: { projectId: string }) {
  return (
    <div
      role="note"
      style={{
        background: "#FFF7E1",
        border: "1px solid #E5D08A",
        borderLeft: "3px solid #F59E0B",
        borderRadius: 6,
        padding: "10px 16px",
        marginBottom: 14,
        fontSize: 13,
        color: "#5c4720",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>
        <strong>Placeholder data.</strong>{" "}
        Import the MS Project schedule to see real Amanvana numbers here.
      </span>
      <Link
        href={`/projects/${projectId}/import`}
        style={{
          background: "#16202F",
          color: "#F3EFE4",
          padding: "6px 12px",
          borderRadius: 4,
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Import schedule
      </Link>
    </div>
  );
}

/**
 * Full-page empty state for when the tab absolutely can't render without data
 * (used sparingly — most tabs prefer PlaceholderBanner + mock preview).
 */
export function EmptyExecutiveState({ projectId, message }: { projectId: string; message?: string }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2DDD0",
        borderRadius: 8,
        padding: "48px 24px",
        textAlign: "center",
        color: "#4E5866",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
      <h3 style={{ margin: 0, fontSize: 16, color: "#1B2432" }}>
        No schedule imported yet
      </h3>
      <p style={{ margin: "8px 0 20px", fontSize: 13.5, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
        {message ?? "This view rolls up data from an imported MS Project schedule. Import once and this dashboard populates."}
      </p>
      <Link
        href={`/projects/${projectId}/import`}
        style={{
          display: "inline-block",
          background: "#16202F",
          color: "#F3EFE4",
          padding: "10px 20px",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textDecoration: "none",
        }}
      >
        Import schedule
      </Link>
    </div>
  );
}
