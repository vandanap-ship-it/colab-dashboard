/**
 * Sentry PII scrubber for Siddhi. Called from the `beforeSend` hook in
 * every runtime config (server + edge + client) so an unhandled error
 * never ships worker Aadhaar numbers, phone numbers, DOBs, or raw photo
 * URLs to the Sentry dashboard.
 *
 * Two layers of protection:
 *   1. Known PII field names are replaced with "[redacted]".
 *   2. Any string value is scanned for 12-digit Aadhaar sequences and
 *      10-digit phone sequences, both masked in place.
 *
 * Keep this list in sync with the fields the induction + progress + permit
 * APIs actually accept. When adding a new PII-bearing field, add its key
 * here first.
 */

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const PII_KEYS = new Set<string>([
  // Worker / induction PII
  "aadhaarNumber",
  "aadhaar",
  "aadhaarFrontUrl",
  "aadhaarBackUrl",
  "signatureUrl",
  "workerPhotoUrl",
  "workerName",
  "contactNumber",
  "phone",
  "phoneNumber",
  "dob",
  "dateOfBirth",
  // Credentials
  "password",
  "passwordHash",
  "token",
  "secret",
  // Email bodies / notes that may embed PII
  "notes",
  "remark",
  "rejectionReason",
]);

const AADHAAR_RX = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;
const PHONE_RX = /\b[6-9]\d{9}\b/g; // Indian mobile numbers

function maskString(value: string): string {
  return value
    .replace(AADHAAR_RX, "[redacted-aadhaar]")
    .replace(PHONE_RX, "[redacted-phone]");
}

function scrub(value: unknown, key?: string): unknown {
  if (key && PII_KEYS.has(key)) return "[redacted]";
  if (value == null) return value;
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Runs on every captured event, before Sentry sends it over the wire.
 * Returning `null` drops the event entirely; we only drop obviously
 * benign noise and otherwise return a scrubbed copy.
 */
export function sentryBeforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Scrub the request payload — captured on API-route errors.
  if (event.request?.data) {
    event.request.data = scrub(event.request.data) as typeof event.request.data;
  }
  // Scrub headers (cookie / authorization already dropped by Sentry's own
  // defaults, but belt and braces).
  if (event.request?.headers) {
    const h = event.request.headers as Record<string, string>;
    for (const k of Object.keys(h)) {
      if (/cookie|authorization|token|secret/i.test(k)) h[k] = "[redacted]";
    }
  }
  // Scrub arbitrary extras attached via setExtra().
  if (event.extra) {
    event.extra = scrub(event.extra) as typeof event.extra;
  }
  // Scrub breadcrumbs — fetch URLs, console messages, etc. may embed PII.
  if (event.breadcrumbs) {
    for (const bc of event.breadcrumbs) {
      if (bc.data) bc.data = scrub(bc.data) as typeof bc.data;
      if (typeof bc.message === "string") bc.message = maskString(bc.message);
    }
  }
  // Scrub exception messages themselves.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = maskString(ex.value);
    }
  }
  // Scrub user context down to the id (which is a cuid, not PII).
  if (event.user) {
    event.user = { id: event.user.id };
  }
  return event;
}

/**
 * Release string for grouping errors by deploy. Vercel exposes the git
 * commit SHA at build time; we fall back to "dev" locally. Keep this in
 * one place so every runtime config tags events the same way.
 */
export function sentryRelease(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE;
}

/**
 * Environment tag. Vercel sets VERCEL_ENV to production / preview /
 * development; falls back to NODE_ENV. Lets us filter prod from
 * preview noise in the Sentry UI.
 */
export function sentryEnvironment(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
}
