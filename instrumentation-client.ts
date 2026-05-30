/**
 * Sentry — client (browser) runtime. Reads NEXT_PUBLIC_SENTRY_DSN so the value
 * is inlined at build time. No-op when unset.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
