import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type UploadResult = { url: string; storage: "blob" | "local" };

/**
 * Upload a file. Uses Vercel Blob if BLOB_READ_WRITE_TOKEN is set;
 * otherwise writes to ./public/uploads/ and returns a `/uploads/...` path.
 */
export async function uploadPhoto(file: File, scope: string): Promise<UploadResult> {
  const ext = path.extname(file.name) || (file.type === "image/png" ? ".png" : ".jpg");
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, "_");
  const key = `${safeScope}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

  // Prefer the newer "..._READ_WRITE_TOKEN" suffix env (Vercel adds this when
  // a second Blob store is connected) over the original BLOB_READ_WRITE_TOKEN
  // (which may still point at the older private store).
  const blobToken =
    process.env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN ??
    process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, file, { access: "public", token: blobToken });
    return { url: blob.url, storage: "blob" };
  }

  const publicDir = path.join(process.cwd(), "public", "uploads", safeScope);
  if (!existsSync(publicDir)) await mkdir(publicDir, { recursive: true });
  const filename = path.basename(key);
  const fullPath = path.join(publicDir, filename);
  const arrayBuffer = await file.arrayBuffer();
  await writeFile(fullPath, Buffer.from(arrayBuffer));
  return { url: `/uploads/${safeScope}/${filename}`, storage: "local" };
}

/**
 * Validate that a fileUrl came from our own uploader, not from the wider
 * internet. Used by endpoints that take a fileUrl as input (e.g. drawing
 * revisions) so an attacker can't store a hostile URL — phishing redirect,
 * malware, "loud" image that doxxes the viewer — as the canonical revision
 * of a sensitive blueprint.
 *
 * Accepts:
 *   - `/uploads/...` (local dev fallback storage)
 *   - any URL whose hostname ends with `.public.blob.vercel-storage.com`
 *     (the only Vercel Blob host @vercel/blob.put() will return)
 *
 * Returns true if the URL is safe to store as a content reference.
 */
export function isOwnUploadUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.startsWith("/uploads/")) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
