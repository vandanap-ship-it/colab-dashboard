import { describe, it, expect } from "vitest";
import { isOwnUploadUrl } from "@/lib/upload";

describe("isOwnUploadUrl", () => {
  it("accepts /uploads/ paths (local dev fallback)", () => {
    expect(isOwnUploadUrl("/uploads/foo/bar.png")).toBe(true);
    expect(isOwnUploadUrl("/uploads/drawings-abc/123-deadbeef.pdf")).toBe(true);
  });

  it("accepts Vercel Blob storage URLs", () => {
    expect(
      isOwnUploadUrl(
        "https://abc123.public.blob.vercel-storage.com/drawings-xyz/1234-deadbeef.pdf",
      ),
    ).toBe(true);
  });

  it("rejects external URLs (the IDOR-via-fileUrl gap)", () => {
    expect(isOwnUploadUrl("https://evil.example/malware.exe")).toBe(false);
    expect(isOwnUploadUrl("https://drive.google.com/file/d/xyz")).toBe(false);
    expect(isOwnUploadUrl("https://images.example.com/wat.png")).toBe(false);
  });

  it("rejects spoofed lookalike hosts", () => {
    // attacker-controlled domain that just happens to contain the magic string
    expect(
      isOwnUploadUrl("https://public.blob.vercel-storage.com.evil.example/x.pdf"),
    ).toBe(false);
    // missing the leading dot would let `something-public.blob.vercel-storage.com` pass
    // — but our suffix check enforces `.public...`, not just `public...`.
    expect(
      isOwnUploadUrl("https://faux-public.blob.vercel-storage.com/x.pdf"),
    ).toBe(false);
  });

  it("rejects insecure (http://) blob URLs", () => {
    expect(
      isOwnUploadUrl("http://abc.public.blob.vercel-storage.com/x.pdf"),
    ).toBe(false);
  });

  it("rejects junk", () => {
    expect(isOwnUploadUrl("")).toBe(false);
    expect(isOwnUploadUrl("not a url")).toBe(false);
    expect(isOwnUploadUrl("uploads/foo.png")).toBe(false); // missing leading slash
    expect(isOwnUploadUrl("javascript:alert(1)")).toBe(false);
    expect(isOwnUploadUrl("file:///etc/passwd")).toBe(false);
  });
});
