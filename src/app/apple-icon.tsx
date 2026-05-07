import { ImageResponse } from "next/og";

// iOS "Add to Home Screen" icon — Apple wants 180x180, no transparency,
// rounded square auto-applied by iOS.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1c1917",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 56, height: 56, background: "#fbbf24", borderRadius: 10 }} />
            <div style={{ width: 56, height: 56, background: "rgba(255,255,255,0.7)", borderRadius: 10 }} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 56, height: 56, background: "rgba(255,255,255,0.5)", borderRadius: 10 }} />
            <div style={{ width: 56, height: 56, background: "rgba(255,255,255,0.85)", borderRadius: 10 }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
