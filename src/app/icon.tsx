import { ImageResponse } from "next/og";

// Generic Siddhi app icon (used by Android, browsers, manifest 192/512).
// Renders at request time from JSX so we don't need static PNG files.

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1c1917", // stone-900
          borderRadius: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 32,
          }}
        >
          {/* Top row */}
          <div style={{ display: "flex", gap: 32 }}>
            <div
              style={{
                width: 160,
                height: 160,
                background: "#fbbf24",
                borderRadius: 28,
              }}
            />
            <div
              style={{
                width: 160,
                height: 160,
                background: "rgba(255,255,255,0.7)",
                borderRadius: 28,
              }}
            />
          </div>
          {/* Bottom row */}
          <div style={{ display: "flex", gap: 32 }}>
            <div
              style={{
                width: 160,
                height: 160,
                background: "rgba(255,255,255,0.5)",
                borderRadius: 28,
              }}
            />
            <div
              style={{
                width: 160,
                height: 160,
                background: "rgba(255,255,255,0.85)",
                borderRadius: 28,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
