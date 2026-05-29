/**
 * Session-token re-validation.
 *
 * role/modules/active live in the JWT, which (with the default 30-day expiry)
 * means a deactivated user — or a contractor whose module access was revoked —
 * would otherwise keep their old access until the token expired. On a small
 * team with external contractors whose access should end with their contract,
 * that's unacceptable.
 *
 * On each request the auth `jwt` callback re-checks the user against the DB
 * (throttled so it's at most once per interval, to avoid a DB hit on every
 * single request). Deactivated/deleted → the session is dropped; otherwise
 * role/username/modules are refreshed so changes take effect promptly.
 *
 * Kept here as a pure, dependency-injected function so it can be unit-tested
 * without standing up NextAuth or a database.
 */

export type SessionToken = {
  id?: unknown;
  role?: string;
  username?: string;
  modules?: string | null;
  validatedAt?: number;
  [key: string]: unknown;
};

export type DbUserSnapshot = {
  active: boolean;
  role: string;
  username: string;
  modules: string | null;
};

/** Default: re-check the DB at most once per minute per session. */
export const REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Re-validate a session token against the current DB user.
 *
 * @returns the refreshed token, or `null` to invalidate the session (NextAuth
 *   clears the session cookie when the jwt callback returns null).
 *
 * Behaviour:
 *  - no id on the token            → returned unchanged (can't look it up)
 *  - within the throttle window    → returned unchanged (skip the DB hit)
 *  - user missing or `active=false`→ `null` (session dropped)
 *  - user active                   → role/username/modules refreshed
 *  - loader throws (transient DB)  → returned unchanged (fail-open, so a DB
 *    blip never logs everyone out; the next request re-checks)
 */
export async function refreshTokenFromDb<T extends SessionToken>(
  token: T,
  loadUser: (id: string) => Promise<DbUserSnapshot | null>,
  opts: { now: number; intervalMs?: number } = { now: 0 },
): Promise<T | null> {
  const id = typeof token.id === "string" ? token.id : null;
  if (!id) return token;

  const intervalMs = opts.intervalMs ?? REVALIDATE_INTERVAL_MS;
  const last = typeof token.validatedAt === "number" ? token.validatedAt : 0;
  if (opts.now - last < intervalMs) return token;

  try {
    const db = await loadUser(id);
    if (!db || !db.active) return null;
    return {
      ...token,
      role: db.role,
      username: db.username,
      modules: db.modules,
      validatedAt: opts.now,
    };
  } catch {
    // Transient DB error: keep the existing token rather than locking everyone
    // out. Re-validation retries on the next request.
    return token;
  }
}
