import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, isAdmin } from "@/lib/roles";

const VALID_ROLES = new Set<string>(Object.values(ROLES));

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: { id: true, username: true, name: true, role: true, designation: true, active: true, createdAt: true },
  });
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { username, name, role, password, designation } = (body ?? {}) as {
    username?: string;
    name?: string;
    role?: string;
    password?: string;
    designation?: string | null;
  };

  const u = (username ?? "").trim().toLowerCase();
  const n = (name ?? "").trim();
  const r = role ?? "";
  const p = password ?? "";
  const d = typeof designation === "string" ? designation.trim() : null;

  if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
    return NextResponse.json({ error: "Username must be 3-30 lowercase letters/numbers/._-" }, { status: 400 });
  }
  if (n.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
  if (!VALID_ROLES.has(r)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  if (p.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { username: u } });
  if (existing) return NextResponse.json({ error: "Username already taken" }, { status: 400 });

  const passwordHash = await bcrypt.hash(p, 10);
  const user = await prisma.user.create({
    data: { username: u, name: n, role: r, passwordHash, designation: d || null },
    select: { id: true, username: true, name: true, role: true, designation: true, active: true, createdAt: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
