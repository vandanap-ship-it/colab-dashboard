import { NextResponse } from "next/server";

/**
 * Shared error helpers for API route handlers.
 *
 * Goals:
 *   - Consistent JSON shape ({ error: string })
 *   - Server errors logged with route tag + stack so Vercel logs are useful
 *   - Prisma "record not found" (P2025) translated to 404
 *
 * Pattern in route handlers:
 *
 *   try {
 *     const x = await prisma.foo.update(...);
 *     return NextResponse.json({ foo: x });
 *   } catch (e) {
 *     return handleApiError(e, "PATCH /api/foo/:id");
 *   }
 */

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden(reason = "Forbidden") {
  return NextResponse.json({ error: reason }, { status: 403 });
}

export function badRequest(reason: string) {
  return NextResponse.json({ error: reason }, { status: 400 });
}

export function notFound(reason = "Not found") {
  return NextResponse.json({ error: reason }, { status: 404 });
}

// Internal helpers used only by handleApiError below.
function isPrismaNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2025"
  );
}

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

export function handleApiError(e: unknown, tag: string): NextResponse {
  if (isPrismaNotFound(e)) return notFound();
  if (isPrismaUniqueViolation(e)) return badRequest("That record already exists.");
  console.error(`[${tag}]`, e);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}
