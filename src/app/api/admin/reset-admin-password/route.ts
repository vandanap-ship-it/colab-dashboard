import { NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

/**
 * One-shot admin password reset for the "admin" account.
 *
 *   POST /api/admin/reset-admin-password
 *   Authorization: Bearer <BOOTSTRAP_TOKEN>
 *
 * Mirrors /api/admin/bootstrap's gating:
 *   1. Without BOOTSTRAP_TOKEN env var, the endpoint 503s. So the reset
 *      path is disabled by default — set the env var only for the
 *      duration of the reset, and unset it right after.
 *   2. Timing-safe compare of the Bearer token so we don't leak length
 *      or character position on a mismatch.
 *   3. Only touches the "admin" account, and only if it's actually
 *      ADMIN-role — a leaked token can't reset arbitrary users, only
 *      re-set the same account bootstrap already created.
 *
 * The endpoint returns the new random password ONCE. Save it, then
 * sign in at /login and rotate from /admin/users if you want a
 * memorable one.
 *
 * Operationally:
 *   1. Set BOOTSTRAP_TOKEN in Vercel env (any long random string).
 *   2. Redeploy so the env reaches the running function.
 *   3. POST here with the Bearer token; save the returned password.
 *   4. Unset BOOTSTRAP_TOKEN in Vercel env and redeploy.
 * Step 4 is the important one — the endpoint refuses everyone again
 * as soon as the env var is gone.
 */

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expectedToken = process.env.BOOTSTRAP_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Reset is disabled. Set BOOTSTRAP_TOKEN env var to enable, then unset after use." },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !tokenMatches(presented, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.user.findFirst({
    where: { username: "admin", role: "ADMIN" },
    select: { id: true, username: true },
  });
  if (!admin) {
    return NextResponse.json(
      { error: "No 'admin' user with ADMIN role found. Use /api/admin/bootstrap on a fresh DB instead." },
      { status: 404 },
    );
  }

  // Same shape as bootstrap: 16 bytes → 22 base64url chars, ~128 bits.
  // Enough entropy that a human copies it once, signs in, and rotates.
  const password = randomBytes(16).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash },
  });

  // Security-sensitive audit: WHO reset the admin password (system,
  // via token) is recorded. The hash and the plaintext are never
  // logged — only the fact of the reset.
  await recordAudit({
    userId: admin.id,
    action: "UPDATE",
    entityType: "User",
    entityId: admin.id,
    summary: `Admin password reset via /api/admin/reset-admin-password (BOOTSTRAP_TOKEN)`,
  });

  return NextResponse.json({
    ok: true,
    username: admin.username,
    password,
    message:
      "Save this password — it is shown only once. Sign in at /login, then unset BOOTSTRAP_TOKEN in Vercel to disable this endpoint again.",
  });
}
