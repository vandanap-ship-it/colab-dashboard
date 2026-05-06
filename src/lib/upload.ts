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

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, file, { access: "public", token: process.env.BLOB_READ_WRITE_TOKEN });
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
