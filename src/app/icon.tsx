import { ImageResponse } from "next/og";

// Siddhi app icon (browser tab + Android/PWA home screen).
// Italic serif "S" + gold accent dot, rendered to 512x512 PNG at request time.

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
          background: "#FFFAF0", // ivory
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 24,
          }}
        >
          <span
            style={{
              fontFamily: "serif",
              fontStyle: "italic",
              fontSize: 360,
              color: "#161926", // charcoal
              lineHeight: 1,
              fontWeight: 700,
            }}
          >
            S
          </span>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 64,
              background: "#CA9F49", // gold
              marginBottom: 32,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
