/**
 * Sentry — browser / client runtime. Next.js 16 loads this file before the
 * React tree boots, so unhandled errors in effects, event handlers, and
 * React render all land in Sentry.
 *
 * Mirrors the server + edge configs: no-op when NEXT_PUBLIC_SENTRY_DSN is
 * unset, same PII scrubber, same release + environment tagging.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend, sentryRelease, sentryEnvironment } from "@/lib/sentryScrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: sentryRelease(),
  environment: sentryEnvironment(),
  tracesSampleRate: 0,
  // Session replay is a separate SDK + extra quota; leave off until we
  // explicitly want it. Error capture alone is cheap and sufficient.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  debug: false,
  sendDefaultPii: false,
  beforeSend: sentryBeforeSend,
});
