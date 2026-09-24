import { NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { MODULES } from "@/lib/modules";
import { ROLES } from "@/lib/roles";

/**
 * One-shot test-user seeder for role + module-scope testing.
 *
 *   POST /api/admin/seed-test-users
 *   Authorization: Bearer <BOOTSTRAP_TOKEN>
 *
 * Gated exactly like /api/admin/bootstrap and
 * /api/admin/reset-admin-password:
 *   1. Without BOOTSTRAP_TOKEN env var → 503.
 *   2. Bearer token compared timing-safe.
 *   3. Only touches usernames prefixed with "test-". A leaked token
 *      cannot use this path to overwrite a real user — the upsert
 *      key is the username, and the username namespace is walled
 *      off. Real users named "planner" / "engineer" / etc. stay
 *      untouched.
 *
 * On each call: for every persona in TEST_USERS below, either create
 * the user (if the "test-{key}" username is new) or reset its password
 * (if it already exists from a prior run). Returns the full set with
 * fresh random passwords in one JSON blob.
 *
 * Cleanup: delete the test-* rows from /admin/users when done, or
 * leave them — they can't sign in without a password, and the next
 * seed run rotates them anyway.
 */

type TestPersona = {
  key: string; // becomes "test-{key}" username
  name: string; // display name
  role: string; // ROLES enum value
  modules: string[] | null; // null = full access
  note: string; // one-liner for the response payload
};

const TEST_USERS: TestPersona[] = [
  // Internal roles (no module scope — full access).
  { key: "admin", name: "Test Admin", role: ROLES.ADMIN, modules: null, note: "Full access, admin surfaces (Users, audit, migrate, etc.)" },
  { key: "planner", name: "Test Planner", role: ROLES.PLANNER, modules: null, note: "Full access, can edit any Progress entry" },
  { key: "product", name: "Test Product", role: ROLES.PRODUCT_TEAM, modules: null, note: "Full access, portfolio landing + all modules" },
  { key: "manager", name: "Test Manager", role: ROLES.SITE_MANAGER, modules: null, note: "Full access, can approve permits" },
  { key: "engineer", name: "Test Engineer", role: ROLES.SITE_ENGINEER, modules: null, note: "Full access as a site engineer (log progress, WIRs, etc.)" },

  // Module-scoped external contractors — one per module. These mirror
  // the personas in the tile-visibility matrix so you can prove that
  // e.g. a PROGRESS-scoped user sees new-progress + manpower + DLR
  // + site-progress + search and NOTHING ELSE.
  { key: "qaqc", name: "Test QA/QC Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.QAQC], note: "QAQC-scoped: qaqc-tile + search only" },
  { key: "safety", name: "Test Safety Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.SAFETY], note: "SAFETY-scoped: ehs-tile + search only" },
  { key: "progress", name: "Test Progress Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.PROGRESS], note: "PROGRESS-scoped: new-progress + manpower(×2) + site-progress + dlr + search" },
  { key: "permit", name: "Test Permit Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.PERMIT], note: "PERMIT-scoped: permit(×2) + search" },
  { key: "hindrance", name: "Test Hindrance Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.HINDRANCE], note: "HINDRANCE-scoped: hindrance(×2) + search" },
  { key: "concern", name: "Test Concern Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.CONCERN], note: "CONCERN-scoped: respective tile + search" },

  // Multi-scope: proves the intersection logic (both quality tiles visible).
  { key: "qaqc-safety", name: "Test QA/QC + Safety Contractor", role: ROLES.SITE_ENGINEER, modules: [MODULES.QAQC, MODULES.SAFETY], note: "Multi-scope: both quality tiles" },
];

const TEST_PREFIX = "test-";

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
      { error: "Seed is disabled. Set BOOTSTRAP_TOKEN env var to enable, then unset after use." },
      { status: 503 },
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !tokenMatches(presented, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    username: string;
    password: string;
    role: string;
    modules: string[] | null;
    note: string;
    created: boolean;
  }> = [];

  for (const persona of TEST_USERS) {
    const username = `${TEST_PREFIX}${persona.key}`;
    const password = randomBytes(16).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 10);
    // JSON string like the rest of the app expects (parseUserModules
    // reads null-or-JSON-array from this column).
    const modulesJson = persona.modules ? JSON.stringify(persona.modules) : null;

    const existing = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: persona.name,
          passwordHash,
          role: persona.role,
          modules: modulesJson,
          active: true,
        },
      });
      results.push({
        username,
        password,
        role: persona.role,
        modules: persona.modules,
        note: persona.note,
        created: false,
      });
    } else {
      const created = await prisma.user.create({
        data: {
          username,
          name: persona.name,
          passwordHash,
          role: persona.role,
          modules: modulesJson,
          designation: "Test account",
        },
      });
      results.push({
        username: created.username,
        password,
        role: persona.role,
        modules: persona.modules,
        note: persona.note,
        created: true,
      });
    }
  }

  // One coarse audit row: the seeded test-admin is stamped as the
  // actor (the caller has no session — this endpoint is
  // token-gated). Passwords + hashes never logged.
  const testAdmin = await prisma.user.findUnique({
    where: { username: `${TEST_PREFIX}admin` },
    select: { id: true },
  });
  if (testAdmin) {
    await recordAudit({
      userId: testAdmin.id,
      action: "CREATE",
      entityType: "User",
      entityId: "*",
      summary: `Seeded ${results.length} test-* users via /api/admin/seed-test-users (BOOTSTRAP_TOKEN)`,
    });
  }

  return NextResponse.json({
    ok: true,
    message:
      "Passwords are shown only once. Save this response. Unset BOOTSTRAP_TOKEN in Vercel to disable this endpoint again.",
    users: results,
  });
}
