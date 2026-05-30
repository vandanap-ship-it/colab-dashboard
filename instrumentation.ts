/**
 * Next.js instrumentation hook. Loads the right Sentry config per runtime so
 * server / edge errors get captured. The client init lives in
 * instrumentation-client.ts.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors that happen while serving an App Router request to Sentry.
export const onRequestError = Sentry.captureRequestError;
