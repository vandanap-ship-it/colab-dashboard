import { describe, it, expect } from "vitest";
import { readIdempotencyKey } from "@/lib/idempotency";

describe("readIdempotencyKey", () => {
  it("extracts a valid string key from the body", () => {
    expect(readIdempotencyKey({ idempotencyKey: "abc-123" })).toBe("abc-123");
  });

  it("trims surrounding whitespace", () => {
    expect(readIdempotencyKey({ idempotencyKey: "  key  " })).toBe("key");
  });

  it("returns null when the body is null / undefined / not an object", () => {
    expect(readIdempotencyKey(null)).toBeNull();
    expect(readIdempotencyKey(undefined)).toBeNull();
    expect(readIdempotencyKey("not-an-object")).toBeNull();
    expect(readIdempotencyKey(42)).toBeNull();
  });

  it("returns null when the field is missing", () => {
    expect(readIdempotencyKey({})).toBeNull();
    expect(readIdempotencyKey({ other: "field" })).toBeNull();
  });

  it("returns null when the field is not a string", () => {
    expect(readIdempotencyKey({ idempotencyKey: 42 })).toBeNull();
    expect(readIdempotencyKey({ idempotencyKey: null })).toBeNull();
    expect(readIdempotencyKey({ idempotencyKey: {} })).toBeNull();
    expect(readIdempotencyKey({ idempotencyKey: ["a"] })).toBeNull();
  });

  it("returns null on empty / whitespace-only strings", () => {
    expect(readIdempotencyKey({ idempotencyKey: "" })).toBeNull();
    expect(readIdempotencyKey({ idempotencyKey: "   " })).toBeNull();
  });

  it("returns null on strings over 100 chars (the DB column cap)", () => {
    const over = "a".repeat(101);
    expect(readIdempotencyKey({ idempotencyKey: over })).toBeNull();
  });

  it("accepts strings exactly at the 100-char boundary", () => {
    const boundary = "a".repeat(100);
    expect(readIdempotencyKey({ idempotencyKey: boundary })).toBe(boundary);
  });

  it("handles a normal UUID-shaped key", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(readIdempotencyKey({ idempotencyKey: uuid })).toBe(uuid);
  });
});
