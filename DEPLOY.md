# Deploy checklist — Colab Dashboard

This is the runbook for deploying the app to production. Treat it as a
sequence — don't skip steps.

---

## 1. Provision the production database (Turso)

We use SQLite in dev (`./dev.db`) and Turso (libSQL) in production. Turso is
SQLite-compatible so no schema rewrite is needed.

1. Sign up at https://turso.tech.
2. `turso db create colab-prod` (or via dashboard).
3. Grab the URL: `turso db show colab-prod --url` → `libsql://colab-prod-xxx.turso.io`.
4. Mint an auth token: `turso db tokens create colab-prod`.
5. Save both as Vercel env vars (next step).

> **Important:** the Prisma `@prisma/adapter-better-sqlite3` is dev-only.
> Switching to Turso means using `@libsql/client` + `@prisma/adapter-libsql`.
> See [Migrating to Turso](#migrating-to-turso) below for the code change.

## 2. Provision photo storage (Vercel Blob)

1. In Vercel dashboard → Storage → create a Blob store named `colab-prod-photos`.
2. Copy the `BLOB_READ_WRITE_TOKEN`.
3. Save as Vercel env var (next step).

`src/lib/upload.ts` already falls back to local disk when the token is missing —
ideal for dev. The token presence flips it into Vercel Blob mode for prod.

## 3. Set Vercel env vars

In your Vercel project → Settings → Environment Variables:

| Name | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `libsql://colab-prod-xxx.turso.io?authToken=…` | Turso URL with auth token in the query string |
| `AUTH_SECRET` | random 32-byte string | Generate: `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` | Required for NextAuth on Vercel |
| `BLOB_READ_WRITE_TOKEN` | from Vercel Blob | Photo upload |
| `NEXTAUTH_URL` | `https://your-domain.com` | Same as production URL |

Apply to **Production** environment. Don't use the dev `AUTH_SECRET` from `.env`.

## 4. First-time deploy

```bash
# from local checkout, push schema to Turso
DATABASE_URL="libsql://...?authToken=..." npx prisma db push

# create the 5 seed users + Amanvana project + 5 contractors
DATABASE_URL="libsql://...?authToken=..." npx prisma db seed
```

Then deploy the app:

```bash
git push origin main      # or trigger Vercel deploy
```

> **Do not run `demo-seed.ts` in production.** It wipes WBS / progress / issues /
> hindrances / concerns / inspections. The script now guards against this — it
> exits if `NODE_ENV=production` and `ALLOW_DEMO_SEED` isn't `1`.

## 5. Smoke-test the deploy

Open the production URL and verify:

- `/login` renders the branded login
- Sign in as `admin` / `password` (CHANGE THIS — see step 6)
- Project list home loads
- Click into Amanvana → all 5 tabs render (will be empty until real schedule import)
- `/admin/users` lets you reset passwords
- `/admin/contractors` loads
- `/profile` lets you update name + change password

If any of these 500, check Vercel logs. The shared `handleApiError` helper logs
the route tag for every 500.

## 6. CRITICAL: change all default passwords

The seed users (`admin`, `planner`, `product`, `manager`, `engineer`) all start
with password `password`. **Change every one immediately** before sharing the
URL with anyone:

1. Sign in as `admin`.
2. `/admin/users` → click the key icon next to each row → set a new strong
   password.
3. Tell each user their new password out-of-band (Slack DM, secure note, etc.).

## 7. Import the real schedule

Once your project's schedule CSV is ready (export from MS Project as
`.csv`):

1. Sign in as `admin` or `planner`.
2. Go to the Amanvana project → click **Import schedule**.
3. Upload the CSV. The importer:
   - Creates contractor records on the fly (any unknown contractor names get
     created with category="Imported").
   - Validates dates (MS Project format `"16 Sep '25"` is supported).
   - Two-pass tree build: inserts all rows, then connects parent/child by
     `taskCode`.
4. After import, verify Snapshot tab populates with real progress %.

To re-import (e.g. schedule revision), pass `replace=true` — the API will wipe
existing WBS for that project and reimport.

## 8. (Optional) Custom domain + SSL

Vercel auto-provisions SSL. Just add your domain in Vercel → Domains.

---

## Migrating to Turso

The dev setup uses `@prisma/adapter-better-sqlite3` for local SQLite. For Turso
we need `@libsql/client` + `@prisma/adapter-libsql`. Apply this change in
`src/lib/prisma.ts` before the first prod deploy:

```ts
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const libsql = createClient({
  url: process.env.DATABASE_URL!,           // libsql://… or file:./dev.db
  authToken: process.env.TURSO_AUTH_TOKEN,  // omitted in dev
});
const adapter = new PrismaLibSQL(libsql);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

Install: `npm i @libsql/client @prisma/adapter-libsql` and remove
`@prisma/adapter-better-sqlite3` + `better-sqlite3` from `package.json` once
verified.

---

## Backups

Turso runs nightly snapshots automatically (paid plan). Configure retention in
Turso dashboard. For belt-and-suspenders, dump weekly:

```bash
turso db shell colab-prod ".dump" > backup-$(date +%Y%m%d).sql
```

Store backups outside Vercel/Turso.

---

## Roll-forward / hotfixes

The standard Next.js + Vercel flow: push to `main` → auto-deploy → Vercel keeps
the previous build for instant rollback (Vercel dashboard → Deployments → click
"Promote to production" on a known-good build).

Schema changes need a migration. Workflow:

```bash
# locally:
npx prisma migrate dev --name add_some_field
git add prisma/migrations
git commit -m "Add some field"
git push

# on prod (one-shot):
DATABASE_URL="libsql://..." npx prisma migrate deploy
```

Don't `prisma db push` in prod — it can drop columns silently. Always use
`prisma migrate deploy`.

---

## Operational notes

- **Logs:** Vercel → project → Logs. Server errors include the route tag
  (e.g. `[PATCH /api/concerns/:id]`) thanks to `handleApiError`.
- **Permission boundaries** are enforced at the API:
  - Reviewer-only mutations (resolve concern/hindrance/issue, pass/reject
    inspection) require `canReview(role)`.
  - Engineer can edit own progress entries; Planner+ can edit any.
  - Admin-only: user CRUD + password reset.
- **Photo uploads:** capped at 10 MB per file, max 12 files per request.
- **CSV import:** capped at 5 MB. Bigger schedules need to be split.
