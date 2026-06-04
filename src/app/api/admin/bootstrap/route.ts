import { NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * One-time admin bootstrap for a fresh deploy (e.g. a brand-new Neon DB).
 *
 *   POST /api/admin/bootstrap
 *   Authorization: Bearer <BOOTSTRAP_TOKEN>
 *
 * Doubly gated:
 *   1. The caller must present a token matching the `BOOTSTRAP_TOKEN` env var,
 *      compared with constant-time equality. Without the env var, the endpoint
 *      is disabled (503) — so deployments that aren't actively being
 *      bootstrapped can't be hijacked even if the DB happens to be empty.
 *   2. As soon as any user row exists, the endpoint 400s forever — defence in
 *      depth in case the token leaks.
 *
 * Operationally: when bootstrapping a fresh Neon, set BOOTSTRAP_TOKEN in
 * Vercel env, deploy, POST with the token, save the returned password,
 * UNSET the env var. The endpoint then refuses everyone, the password is
 * the only path in, and that path is yours.
 */

/** Constant-time compare two strings; returns false on length mismatch. */
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
      { error: "Bootstrap is disabled. Set BOOTSTRAP_TOKEN env var to enable, then unset after use." },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !tokenMatches(presented, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    return NextResponse.json(
      {
        error:
          "Already bootstrapped — users exist on this database. Sign in via /login instead.",
      },
      { status: 400 },
    );
  }

  // 16 bytes → 22 base64url chars, ~128 bits of entropy. Plenty for a
  // throwaway initial credential the human will immediately rotate.
  const password = randomBytes(16).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username: "admin",
        name: "Admin",
        passwordHash,
        role: "ADMIN",
        designation: "Administrator",
      },
      select: { id: true, username: true, role: true },
    });
    return NextResponse.json({
      ok: true,
      username: user.username,
      password,
      message:
        "Save this password — it is shown only once. Sign in at /login and change it from /admin/users.",
    });
  } catch (e) {
    // A concurrent bootstrap won the unique-username race. Either way, the DB
    // is no longer empty.
    console.error("[POST /api/admin/bootstrap]", e);
    return NextResponse.json(
      { error: "Bootstrap failed; the DB may already be in use." },
      { status: 500 },
    );
  }
}
