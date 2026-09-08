import { describe, it, expect } from "vitest";
import {
  allowedWorkPermitTransition,
  isApprover,
  isValidHhMm,
  parseApproverIds,
  serializeApproverIds,
} from "@/lib/workPermit";

describe("allowedWorkPermitTransition", () => {
  it("PENDING → APPROVED = approve", () => {
    expect(allowedWorkPermitTransition("PENDING", "APPROVED")).toBe("approve");
  });

  it("PENDING → REJECTED = reject", () => {
    expect(allowedWorkPermitTransition("PENDING", "REJECTED")).toBe("reject");
  });

  it("APPROVED → REJECTED = reject (rare — approver realizes setup unsafe)", () => {
    expect(allowedWorkPermitTransition("APPROVED", "REJECTED")).toBe("reject");
  });

  it("APPROVED → CLOSED = close (happy-path end of day)", () => {
    expect(allowedWorkPermitTransition("APPROVED", "CLOSED")).toBe("close");
  });

  it("blocks PENDING → CLOSED (can't close without approving)", () => {
    expect(allowedWorkPermitTransition("PENDING", "CLOSED")).toBeNull();
  });

  it("blocks REJECTED → anything (rejected is terminal for that permit)", () => {
    expect(allowedWorkPermitTransition("REJECTED", "APPROVED")).toBeNull();
    expect(allowedWorkPermitTransition("REJECTED", "CLOSED")).toBeNull();
    expect(allowedWorkPermitTransition("REJECTED", "PENDING")).toBeNull();
  });

  it("blocks CLOSED → anything (closed is terminal)", () => {
    expect(allowedWorkPermitTransition("CLOSED", "APPROVED")).toBeNull();
    expect(allowedWorkPermitTransition("CLOSED", "REJECTED")).toBeNull();
    expect(allowedWorkPermitTransition("CLOSED", "PENDING")).toBeNull();
  });

  it("blocks same-status no-ops (X → X)", () => {
    expect(allowedWorkPermitTransition("PENDING", "PENDING")).toBeNull();
    expect(allowedWorkPermitTransition("APPROVED", "APPROVED")).toBeNull();
  });

  it("blocks illegal jump PENDING → CLOSED", () => {
    // A closer can't skip the approval step. Guarded because otherwise a
    // requester could self-close their own pending permit and bypass the
    // whole approval workflow.
    expect(allowedWorkPermitTransition("PENDING", "CLOSED")).toBeNull();
  });
});

describe("approverIds JSON helpers", () => {
  it("round-trips a normal list", () => {
    const ids = ["u1", "u2", "u3"];
    const json = serializeApproverIds(ids);
    expect(parseApproverIds(json)).toEqual(ids);
  });

  it("returns [] for null/undefined/empty", () => {
    expect(parseApproverIds(null)).toEqual([]);
    expect(parseApproverIds(undefined)).toEqual([]);
    expect(parseApproverIds("")).toEqual([]);
  });

  it("returns [] for malformed JSON (never throws)", () => {
    expect(parseApproverIds("{not json")).toEqual([]);
    expect(parseApproverIds("not an array")).toEqual([]);
    expect(parseApproverIds('"just a string"')).toEqual([]);
    expect(parseApproverIds('{"foo":"bar"}')).toEqual([]);
  });

  it("filters non-string / empty entries defensively", () => {
    // If the stored JSON somehow includes junk, parseApproverIds sanitizes
    // instead of feeding garbage to the DB WHERE-in query.
    expect(parseApproverIds('["u1",null,"",42,"u2"]')).toEqual(["u1", "u2"]);
  });

  it("isApprover exact-matches an id in the list", () => {
    const json = serializeApproverIds(["u1", "u2", "u3"]);
    expect(isApprover(json, "u2")).toBe(true);
    expect(isApprover(json, "u4")).toBe(false);
  });

  it("isApprover on a null/empty list is always false", () => {
    expect(isApprover(null, "u1")).toBe(false);
    expect(isApprover("[]", "u1")).toBe(false);
  });

  it("isApprover does not match a substring — needs exact id", () => {
    // Prevents "u1" from matching approver "u10". Would be a real bug if
    // the substring-based JSON search from the list endpoint bled into the
    // authorization check.
    const json = serializeApproverIds(["u10", "u20"]);
    expect(isApprover(json, "u1")).toBe(false);
    expect(isApprover(json, "u2")).toBe(false);
    expect(isApprover(json, "u10")).toBe(true);
  });
});

describe("isValidHhMm", () => {
  it("accepts common valid times", () => {
    expect(isValidHhMm("00:00")).toBe(true);
    expect(isValidHhMm("09:00")).toBe(true);
    expect(isValidHhMm("15:32")).toBe(true);
    expect(isValidHhMm("23:59")).toBe(true);
  });

  it("rejects invalid hours or minutes", () => {
    expect(isValidHhMm("24:00")).toBe(false);
    expect(isValidHhMm("12:60")).toBe(false);
    expect(isValidHhMm("-1:00")).toBe(false);
    expect(isValidHhMm("9:00")).toBe(false); // needs leading zero
  });

  it("rejects garbage strings", () => {
    expect(isValidHhMm("")).toBe(false);
    expect(isValidHhMm("nine")).toBe(false);
    expect(isValidHhMm("09.00")).toBe(false);
    expect(isValidHhMm("09:00:00")).toBe(false); // no seconds — that's a stricter format
  });
});
