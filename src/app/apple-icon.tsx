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
          background: "#FFFAF0", // ivory
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "serif",
              fontStyle: "italic",
              fontSize: 128,
              color: "#161926",
              lineHeight: 1,
              fontWeight: 700,
            }}
          >
            S
          </span>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 22,
              background: "#CA9F49",
              marginBottom: 12,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
