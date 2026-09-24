import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { ALL_MODULES, type ModuleKey } from "@/lib/modules";
import { ROLES } from "@/lib/roles";

/**
 * One-shot bulk setup for real users on prod — used by pre-walkthrough
 * or pre-launch orchestration when someone needs to line up passwords
 * + module scopes + role for a handful of accounts at once.
 *
 *   POST /api/admin/setup-real-users
 *   Authorization: Bearer <BOOTSTRAP_TOKEN>
 *   Body: {
 *     commonPassword?: string,           // ≥4 chars; if set, applied to every listed user
 *     users: [{
 *       username: string,                // must already exist; missing usernames land in `notFound`
 *       role?: string,                   // one of ROLES.* — if omitted, role is left alone
 *       modules?: string[] | null,       // module keys (scoped) or null (full access) — if key is
 *                                        //   omitted from the object, modules are left alone
 *       canApproveWorkPermits?: boolean, // if omitted, flag is left alone
 *     }]
 *   }
 *
 * Never creates users. Never deletes users. Never touches audit
 * history. Sets active=true on every listed user so re-enabling +
 * setting up in one call works. Response reports what actually
 * changed per user so the caller can catch typos (found: false).
 *
 * Same gating as the other recovery endpoints — 503 if
 * BOOTSTRAP_TOKEN env is unset, 401 on token mismatch.
 */

const VALID_ROLES = new Set<string>(Object.values(ROLES));
const VALID_MODULES = new Set<string>(ALL_MODULES);

type UserUpdate = {
  username: string;
  role?: string;
  modules?: string[] | null;
  canApproveWorkPermits?: boolean;
};

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
      { error: "Setup is disabled. Set BOOTSTRAP_TOKEN env var to enable, then unset after use." },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !tokenMatches(presented, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { commonPassword?: unknown; users?: unknown }
    | null;
  if (!body || !Array.isArray(body.users) || body.users.length === 0) {
    return NextResponse.json(
      { error: "Body must be { commonPassword?, users: [...] } with a non-empty users array." },
      { status: 400 },
    );
  }

  let commonPassword: string | null = null;
  if (typeof body.commonPassword === "string") {
    const trimmed = body.commonPassword.trim();
    if (trimmed.length < 4) {
      return NextResponse.json(
        { error: "commonPassword, when provided, must be at least 4 characters." },
        { status: 400 },
      );
    }
    commonPassword = trimmed;
  }

  // Coerce + validate each user entry. Anything invalid gets rejected
  // up front so a partial success doesn't leave prod in a half-set
  // state.
  const updates: UserUpdate[] = [];
  for (const raw of body.users) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Each users entry must be an object." }, { status: 400 });
    }
    const u = raw as Record<string, unknown>;
    const username = typeof u.username === "string" ? u.username.trim() : "";
    if (!username) {
      return NextResponse.json({ error: "Each users entry needs a username." }, { status: 400 });
    }
    const entry: UserUpdate = { username };
    if (u.role !== undefined) {
      if (typeof u.role !== "string" || !VALID_ROLES.has(u.role)) {
        return NextResponse.json(
          { error: `Invalid role for ${username}. Allowed: ${Array.from(VALID_ROLES).join(", ")}` },
          { status: 400 },
        );
      }
      entry.role = u.role;
    }
    if ("modules" in u) {
      if (u.modules === null) {
        entry.modules = null;
      } else if (Array.isArray(u.modules)) {
        const bad = u.modules.filter((m) => typeof m !== "string" || !VALID_MODULES.has(m));
        if (bad.length > 0) {
          return NextResponse.json(
            { error: `Unknown module(s) for ${username}: ${bad.join(", ")}. Allowed: ${Array.from(VALID_MODULES).join(", ")}` },
            { status: 400 },
          );
        }
        entry.modules = u.modules as string[];
      } else {
        return NextResponse.json(
          { error: `modules for ${username} must be null or a string array.` },
          { status: 400 },
        );
      }
    }
    if (u.canApproveWorkPermits !== undefined) {
      if (typeof u.canApproveWorkPermits !== "boolean") {
        return NextResponse.json(
          { error: `canApproveWorkPermits for ${username} must be a boolean.` },
          { status: 400 },
        );
      }
      entry.canApproveWorkPermits = u.canApproveWorkPermits;
    }
    updates.push(entry);
  }

  const passwordHash = commonPassword ? await bcrypt.hash(commonPassword, 10) : null;

  const results: Array<{
    username: string;
    found: boolean;
    changes?: {
      passwordReset: boolean;
      role?: string;
      modules?: string[] | null;
      canApproveWorkPermits?: boolean;
    };
  }> = [];

  for (const u of updates) {
    const found = await prisma.user.findUnique({
      where: { username: u.username },
      select: { id: true },
    });
    if (!found) {
      results.push({ username: u.username, found: false });
      continue;
    }
    const data: Record<string, unknown> = { active: true };
    const changes: {
      passwordReset: boolean;
      role?: string;
      modules?: string[] | null;
      canApproveWorkPermits?: boolean;
    } = { passwordReset: false };
    if (passwordHash) {
      data.passwordHash = passwordHash;
      changes.passwordReset = true;
    }
    if (u.role !== undefined) {
      data.role = u.role;
      changes.role = u.role;
    }
    if ("modules" in u) {
      // parseUserModules reads null-or-JSON-array from this column.
      // Empty array collapses to null in that helper (= full access),
      // but we preserve the caller's intent as-is here so the audit
      // is honest.
      data.modules = u.modules === null ? null : JSON.stringify(u.modules);
      changes.modules = u.modules ?? null;
    }
    if (u.canApproveWorkPermits !== undefined) {
      data.canApproveWorkPermits = u.canApproveWorkPermits;
      changes.canApproveWorkPermits = u.canApproveWorkPermits;
    }
    await prisma.user.update({ where: { id: found.id }, data });
    results.push({ username: u.username, found: true, changes });
  }

  // Audit trail — actor is the first successfully-updated user's id if
  // any, else skipped. Passwords + hashes never logged.
  const firstFound = results.find((r) => r.found);
  if (firstFound) {
    const actor = await prisma.user.findUnique({
      where: { username: firstFound.username },
      select: { id: true },
    });
    if (actor) {
      const foundCount = results.filter((r) => r.found).length;
      await recordAudit({
        userId: actor.id,
        action: "UPDATE",
        entityType: "User",
        entityId: "*",
        summary: `Bulk-updated ${foundCount} real users via /api/admin/setup-real-users (BOOTSTRAP_TOKEN)`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    message:
      "Users updated in place. Passwords take effect immediately. Unset BOOTSTRAP_TOKEN in Vercel to disable this endpoint again.",
    results,
  });
}
