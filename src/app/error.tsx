"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

/**
 * Route-level error boundary. Catches errors thrown while rendering a route
 * segment (server component query failures, unexpected exceptions) and shows
 * a graceful recovery screen instead of a crash.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console so it's visible in devtools regardless
    // of Sentry. The digest links to the server-side stack in Vercel logs.
    console.error("[route error]", error);
    // Sentry.captureException is a no-op when NEXT_PUBLIC_SENTRY_DSN isn't
    // set (the client init at sentry.client.config.ts / instrumentation-client.ts
    // silently does nothing without a DSN), so this is safe to run in every
    // deploy — captures land once the DSN is pasted into Vercel env, no code
    // change needed.
    Sentry.captureException(error, {
      tags: { source: "route-error-boundary", digest: error.digest },
    });
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center bg-ivory">
      <p className="text-xs uppercase tracking-widest text-stone-500">Something went wrong</p>
      <h1 className="text-3xl font-semibold text-stone-900 mt-2">We hit a snag</h1>
      <p className="text-sm text-stone-500 mt-2 max-w-md">
        This screen ran into an unexpected error. Your data is safe. Try again, or head back to
        your dashboard.
      </p>
      {error.digest && (
        <p className="text-[11px] text-stone-400 mt-3 font-mono">Reference: {error.digest}</p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-stone-900 text-white text-sm font-medium px-5 py-2 hover:bg-stone-800"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-stone-300 text-stone-700 text-sm font-medium px-5 py-2 hover:border-stone-400"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
