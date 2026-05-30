/**
 * Sentry — edge runtime (middleware, edge functions). Same DSN, same posture
 * as the server config. No-op until SENTRY_DSN is set.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  debug: false,
});
