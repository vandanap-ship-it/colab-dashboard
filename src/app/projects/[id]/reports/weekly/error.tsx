"use client";

/**
 * Route-level error boundary for the Weekly Report page. The report view is
 * a client component with ~30 nested .map() calls on the report shape;
 * historical data with a missing property (e.g. a milestone with no
 * `wbsNodes` array) throws during SSR and shows a bare 500 to the user.
 *
 * A page-level try/catch in page.tsx doesn't catch React render errors —
 * those bubble to the nearest error.tsx boundary. This one shows a
 * friendly fallback with the error message + a way back, so the walkthrough
 * demo doesn't hit a "Server Error" screen.
 */
import Link from "next/link";
import { useEffect } from "react";

export default function WeeklyReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[weekly-report] render failed", error);
  }, [error]);

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-4">
        <h1 className="text-lg font-semibold text-amber-900">
          Weekly Report could not be rendered
        </h1>
        <p className="text-sm text-amber-800">
          The report engine ran into an unexpected data shape. This is a
          known post-launch fix; other reports (Master, DPR, DLR, Observations)
          are working normally.
        </p>
        <details className="text-xs text-amber-800">
          <summary className="cursor-pointer font-medium">
            Technical details
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-amber-100/60 p-2 rounded">
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        </details>
        <div className="flex gap-2 pt-2">
          <button
            onClick={reset}
            className="rounded-md bg-amber-900 text-white text-sm font-medium px-4 py-2 hover:bg-amber-800"
          >
            Try again
          </button>
          <Link
            href="../master"
            className="rounded-md bg-white border border-amber-300 text-amber-900 text-sm font-medium px-4 py-2 hover:bg-amber-100"
          >
            Open Master Report instead
          </Link>
        </div>
      </div>
    </div>
  );
}
