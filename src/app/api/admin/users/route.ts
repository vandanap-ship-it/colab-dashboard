import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdmin } from "@/lib/roles";
import { serializeModules } from "@/lib/modules";
import { parseBody } from "@/lib/parseBody";

const VALID_ROLES = new Set<string>(Object.values(ROLES));

const PostUserSchema = z.object({
  // 60 chars is generous headroom — long enough for `test.assignee.<timestamp>-<rand>`
  // patterns from the E2E suite AND real "firstname.lastname@subteam" style names.
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/, "Username must be lowercase letters/numbers/._-"),
  name: z.string().min(2).max(120),
  role: z.string().refine((v) => VALID_ROLES.has(v), { message: "Invalid role" }),
  password: z.string().min(6).max(200),
  designation: z.string().max(120).nullable().optional(),
  modules: z.array(z.string().max(60)).nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: { id: true, username: true, name: true, role: true, designation: true, modules: true, active: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseBody(req, PostUserSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const u = body.username.trim().toLowerCase();
  const n = body.name.trim();
  const r = body.role;
  const p = body.password;
  const d = body.designation?.trim() ?? null;
  const mods = serializeModules(body.modules ?? null);

  const existing = await prisma.user.findUnique({ where: { username: u } });
  if (existing) return NextResponse.json({ error: "Username already taken" }, { status: 400 });

  const passwordHash = await bcrypt.hash(p, 10);
  const user = await prisma.user.create({
    data: { username: u, name: n, role: r, passwordHash, designation: d || null, modules: mods },
    select: { id: true, username: true, name: true, role: true, designation: true, modules: true, active: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
