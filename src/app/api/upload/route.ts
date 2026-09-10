import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadPhoto } from "@/lib/upload";
import { badRequest, unauthorized } from "@/lib/apiErrors";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 12;

// Give the function the full 60s Vercel Pro window. The old sequential-loop
// version was ~1.3s per file over Bombay-region ingress, so a 12-file
// (drawings register) upload sat at ~15s. Parallel puts drop that to one
// round-trip's worth (~2s) but the ceiling matters if a phone is on very
// weak signal.
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Invalid form data");
  }

  const scope = (form.get("scope")?.toString() || "misc").replace(/[^a-zA-Z0-9_-]/g, "_");
  const files = form.getAll("file").filter((x): x is File => x instanceof File);

  if (files.length === 0) return badRequest("No files");
  if (files.length > MAX_FILES) return badRequest(`Too many files (max ${MAX_FILES})`);

  // Validate everything up front so a bad file at index 3 doesn't leave a
  // half-uploaded batch on Blob storage. Only after all files pass do we
  // start any network work.
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      return badRequest(`File ${f.name} exceeds 10MB`);
    }
    // Some iPhone photos come through with type "image/heic", "image/jpg",
    // or even empty type. Accept anything that's an image-ish type, has a
    // recognisable image extension, or is a PDF (used by the drawing
    // register). PDFs are stored, never executed, so they're safe.
    const looksLikeImage =
      f.type.startsWith("image/") ||
      /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name);
    const looksLikePdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!looksLikeImage && !looksLikePdf) {
      return badRequest(`File ${f.name} is not an image or PDF (type: ${f.type || "unknown"})`);
    }
  }

  try {
    // Parallel uploads. Each @vercel/blob put is an independent HTTPS
    // request to the Blob edge — they don't share connection state, so
    // Promise.all is a real win for the 4-photo mobile submit path.
    const results = await Promise.all(files.map((f) => uploadPhoto(f, scope)));
    return NextResponse.json({ urls: results.map((r) => r.url) });
  } catch (e) {
    // Surface the underlying error message so debugging from the client is
    // possible. Don't leak stack traces.
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[POST /api/upload]", e);
    return NextResponse.json(
      { error: `Photo upload failed: ${message}` },
      { status: 500 },
    );
  }
}
