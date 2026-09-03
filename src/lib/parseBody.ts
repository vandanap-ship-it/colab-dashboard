import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Permissive date-string validator. Accepts anything `new Date()` can parse,
 * which covers both YYYY-MM-DD (what most of our client forms send from a
 * `<input type="date">`) AND full ISO 8601 timestamps.
 *
 * Use in place of `z.string().datetime({ offset: true })` when the field can
 * legitimately arrive in either shape — mixing the two was our biggest
 * source of 400s during the Tier 2.1 rollout.
 */
export const zDateString = z.string().refine(
  (v) => !Number.isNaN(new Date(v).getTime()),
  { message: "Invalid date" },
);

// Shared helper for API-route request-body validation.
//
// Usage:
//   const Schema = z.object({
//     contractorId: z.string().min(1),
//     scope: z.enum(["untagged", "block", "villa", "villa-list", "all"]),
//     villaNumbers: z.array(z.number().int().positive()).optional(),
//   });
//
//   export async function POST(req: Request) {
//     const parsed = await parseBody(req, Schema);
//     if (!parsed.ok) return parsed.response;
//     const body = parsed.data;
//     // ... body is fully typed and validated
//   }
//
// Rules for schemas (from the audit — enforce at review):
//   - Every field has a min length / value where meaningful (no `z.string()` alone).
//   - Enums where a field has a fixed vocabulary.
//   - `.optional()` for genuinely optional; NEVER `.optional()` to make the
//     compiler shut up.
//   - Coerce to Date via `z.coerce.date()` when accepting ISO strings.
//
// Response contract:
//   400 { error, details } where details = zod's issue array.

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      ),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Request body failed validation",
          details: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}
