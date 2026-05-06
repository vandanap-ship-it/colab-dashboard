import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadPhoto } from "@/lib/upload";
import { badRequest, handleApiError, unauthorized } from "@/lib/apiErrors";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 12;

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

  const urls: string[] = [];
  try {
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        return badRequest(`File ${f.name} exceeds 10MB`);
      }
      if (!f.type.startsWith("image/")) {
        return badRequest(`File ${f.name} is not an image`);
      }
      const result = await uploadPhoto(f, scope);
      urls.push(result.url);
    }
    return NextResponse.json({ urls });
  } catch (e) {
    return handleApiError(e, "POST /api/upload");
  }
}
