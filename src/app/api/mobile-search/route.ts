import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { mobileSearch } from "@/lib/mobileSearch";

/**
 * GET /api/mobile-search?projectId=…&q=…
 *
 * Server-side cross-entity search for the mobile search page. Authed only —
 * scoping happens inside {@link mobileSearch} using the caller's modules
 * field. Two-char minimum (single-letter queries would return the whole
 * project and blow the payload).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const q = searchParams.get("q") ?? "";
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const result = await mobileSearch(projectId, q, session.user.modules);
  return NextResponse.json(result);
}
