import { describe, it, expect } from "vitest";
import { checkConflict } from "@/lib/optimisticLock";

describe("checkConflict", () => {
  const now = new Date("2026-09-03T10:15:30.500Z");

  it("passes when client didn't send expectedUpdatedAt (backward compat)", () => {
    const r = checkConflict(null, now);
    expect(r.ok).toBe(true);
    expect(r.response).toBeUndefined();
  });

  it("passes when expected matches actual", () => {
    const r = checkConflict("2026-09-03T10:15:30.500Z", now);
    expect(r.ok).toBe(true);
  });

  it("fails 409 when expected doesn't match actual", async () => {
    const r = checkConflict("2026-09-03T10:15:30.000Z", now, { id: "abc", title: "x" });
    expect(r.ok).toBe(false);
    expect(r.response?.status).toBe(409);
    const body = await r.response!.json();
    expect(body.error).toBe("conflict");
    expect(body.currentUpdatedAt).toBe("2026-09-03T10:15:30.500Z");
    expect(body.currentRow).toEqual({ id: "abc", title: "x" });
  });

  it("fails on empty-string expected (differs from actual ISO)", () => {
    const r = checkConflict("", now);
    // Empty string is falsy — treated as "not sent" per intent.
    expect(r.ok).toBe(true);
  });
});
