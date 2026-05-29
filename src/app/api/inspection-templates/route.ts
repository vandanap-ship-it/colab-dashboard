import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseUserModules } from "@/lib/modules";

/**
 * List active inspection templates for the template picker.
 * Scoped contractors only see templates for their module(s); full-access
 * staff see all. Untagged (general) templates are visible to everyone.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.inspectionTemplate.findMany({
    where: { active: true },
    orderBy: { orderIndex: "asc" },
    include: { items: { orderBy: { seq: "asc" }, select: { seq: true, section: true, description: true } } },
  });

  const mods = parseUserModules(session.user.modules);
  const visible =
    mods === null
      ? templates
      : templates.filter((t) => t.module === null || mods.has(t.module as never));

  return NextResponse.json({
    templates: visible.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      activity: t.activity,
      module: t.module,
      items: t.items,
    })),
  });
}
