import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * One-time admin bootstrap for a fresh deploy (e.g. staging on a brand-new DB).
 *
 *   POST /api/admin/bootstrap
 *
 * If the DB has no users, creates a single admin account with a freshly
 * generated random password and returns the plaintext exactly once. As soon as
 * any user exists, this endpoint becomes a 400 forever — so prod (which is
 * already populated) can't be hijacked through it.
 *
 * The admin should sign in immediately, change the password from
 * /admin/users, and create the real user accounts from there.
 */
export async function POST() {
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
