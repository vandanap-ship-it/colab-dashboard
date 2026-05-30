/**
 * Sentry — server / Node.js runtime.
 *
 * Activates only when SENTRY_DSN is set in the environment (Vercel project
 * settings). When unset, Sentry.init is a no-op and the app behaves as if
 * Sentry weren't installed.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Error capture only — performance/profiling left off to stay well inside
  // the free-tier event quota. Flip on later if we want traces.
  tracesSampleRate: 0,
  debug: false,
});
