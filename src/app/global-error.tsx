"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary. Catches errors in the root layout itself (where
 * the normal error.tsx can't render because the layout failed). Must render
 * its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#FFFAF0",
          color: "#161926",
          padding: "0 24px",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Siddhi hit an unexpected error</h1>
        <p style={{ color: "#6b7280", marginTop: 8, maxWidth: 420 }}>
          Something went wrong loading the app. Your data is safe. Please reload.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            borderRadius: 999,
            background: "#161926",
            color: "#fff",
            border: "none",
            fontSize: 14,
            fontWeight: 500,
            padding: "8px 20px",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
