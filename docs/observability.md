# Error observability

Siddhi captures unhandled errors from every runtime (server, edge, client) and
sends them to Sentry. This page documents what's wired, what Vandana has to
set up in the Sentry dashboard + Vercel, and how PII is scrubbed on the way
out.

## What's wired

- `@sentry/nextjs` v10 installed.
- `instrumentation.ts` loads the right runtime config per request.
- `sentry.server.config.ts` + `sentry.edge.config.ts` + `instrumentation-client.ts`
  all init Sentry with the same posture: errors only (no performance
  traces), no default PII, release tagged with the Vercel git SHA, env
  tagged with the Vercel env name.
- `src/lib/sentryScrub.ts` is the shared `beforeSend` hook — redacts
  known PII field names and masks any 12-digit Aadhaar or Indian mobile
  number pattern found in request bodies, breadcrumbs, exception
  messages, headers, and user context.
- `next.config.ts` wraps the config with `withSentryConfig`. Source maps
  upload to Sentry at build time when `SENTRY_AUTH_TOKEN` is set,
  skipped silently otherwise.

## What Vandana does to turn it on

Fifteen minutes end-to-end.

### 1. Create the Sentry project

- Sign in at sentry.io (free tier covers Siddhi for the foreseeable future).
- Create a new project. Platform = **Next.js**. Alert quota = default.
- From the project's "Client Keys (DSN)" settings page, copy the DSN
  string. Keep this handy.

### 2. Add two env vars to Vercel

In Vercel → Project Settings → Environment Variables, add:

| Name | Value | Environments |
|---|---|---|
| `SENTRY_DSN` | the DSN from step 1 | Production, Preview |
| `NEXT_PUBLIC_SENTRY_DSN` | the same DSN | Production, Preview |

`NEXT_PUBLIC_*` is needed because the client config runs in the browser
and only `NEXT_PUBLIC_` env vars are exposed there. Server + edge read
`SENTRY_DSN` which never ships to the client.

Do **not** add these to the Development environment. We want local dev
errors staying local, not polluting the Sentry dashboard.

### 3. (Optional, recommended) Add source-map upload

If you want stack traces to show real filenames + line numbers:

| Name | Value | Environments |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | token from Sentry → Account → API → Auth Tokens, scope `project:releases` | Production, Preview |
| `SENTRY_ORG` | your Sentry org slug | Production, Preview |
| `SENTRY_PROJECT` | the project slug from step 1 | Production, Preview |

Without these, errors still land in Sentry; traces just show minified
code. Add later if you want.

### 4. Set up alert rules in Sentry

In Sentry → Alerts → New Alert Rule:

- **First seen** of a new issue → email Vandana. Fires once per unique
  stack trace.
- **High frequency** (optional) → 10+ events in 1 hour → email + Slack.
  Catches spikes we need to react to that day.

Nothing else. Low noise, high signal.

## What gets scrubbed

The `beforeSend` hook in `src/lib/sentryScrub.ts` is where PII is
redacted. Scrubbed before Sentry sees them:

- Known PII field names across request bodies, extras, breadcrumbs:
  `aadhaarNumber`, `aadhaarFrontUrl`, `aadhaarBackUrl`, `signatureUrl`,
  `workerPhotoUrl`, `workerName`, `contactNumber`, `phone`,
  `phoneNumber`, `dob`, `dateOfBirth`, `password`, `passwordHash`,
  `token`, `secret`, `notes`, `remark`, `rejectionReason`.
- 12-digit Aadhaar sequences (`\d{4}\s?\d{4}\s?\d{4}`) in any string,
  regardless of key name.
- 10-digit Indian mobile numbers (`[6-9]\d{9}`) in any string.
- Auth / cookie / token headers.
- User context — only `user.id` (a cuid, not PII) is preserved; email
  and name are dropped.

When adding a new PII-bearing field to the schema or an API payload,
update the `PII_KEYS` set in `src/lib/sentryScrub.ts` in the same PR.

## How to read a Sentry alert

- Email lands with a link to the Sentry issue page.
- Issue page shows: error message, stack trace, request URL, release
  SHA, environment, affected users (by cuid), event count.
- First action is usually to click the release SHA and compare the diff
  against the last known-good deploy.

## Verifying it works

Once SENTRY_DSN is live in Vercel:

1. Visit a non-existent route like `/this-does-not-exist`. That's a
   normal 404, not a Sentry event — Sentry only captures unhandled
   errors.
2. Hit an API endpoint with a deliberately malformed payload to force a
   500. The event lands in Sentry within a minute.
3. Open the Sentry issue, confirm the body shows redacted fields where
   expected.

If step 3 shows unredacted PII, raise it immediately — the scrubber is
wrong and needs a fix before more errors land.

## What's intentionally not captured

- Performance traces (free tier is error-only).
- Session replay (separate quota, not needed yet).
- Breadcrumbs from console.log in production (noisy, low value).
- Development environment errors (would overwhelm the dashboard).

Flip any of these on later from the config file if we need them.
