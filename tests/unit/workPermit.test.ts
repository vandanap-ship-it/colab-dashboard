import { describe, it, expect } from "vitest";
import {
  allowedWorkPermitTransition,
  isApprover,
  isValidHhMm,
  parseApproverIds,
  serializeApproverIds,
  generatePermitDisplayId,
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

  // Colab-parity SUSPENDED workflow (added 2026-09-30, commit c6db4d3).
  // Suspend pauses an approved permit; Resume re-approves; a suspended
  // permit can also close or reject terminally.
  it("APPROVED → SUSPENDED = suspend", () => {
    expect(allowedWorkPermitTransition("APPROVED", "SUSPENDED")).toBe("suspend");
  });

  it("SUSPENDED → APPROVED = resume", () => {
    expect(allowedWorkPermitTransition("SUSPENDED", "APPROVED")).toBe("resume");
  });

  it("SUSPENDED → CLOSED = close (retire a paused permit at end of shift)", () => {
    expect(allowedWorkPermitTransition("SUSPENDED", "CLOSED")).toBe("close");
  });

  it("SUSPENDED → REJECTED = reject (permit can't be safely resumed)", () => {
    expect(allowedWorkPermitTransition("SUSPENDED", "REJECTED")).toBe("reject");
  });

  it("blocks PENDING → SUSPENDED (nothing to pause yet)", () => {
    expect(allowedWorkPermitTransition("PENDING", "SUSPENDED")).toBeNull();
  });

  it("blocks CLOSED → SUSPENDED and REJECTED → SUSPENDED (terminal states)", () => {
    expect(allowedWorkPermitTransition("CLOSED", "SUSPENDED")).toBeNull();
    expect(allowedWorkPermitTransition("REJECTED", "SUSPENDED")).toBeNull();
  });
});

describe("generatePermitDisplayId", () => {
  it("returns a PER-XXXXXXXX format id", () => {
    const id = generatePermitDisplayId();
    expect(id).toMatch(/^PER-[A-Z0-9]{8}$/);
  });

  it("uses an unambiguous alphabet (no I, O, 0, 1 in the suffix)", () => {
    // Sample the generator 500 times — with 500 samples of 8 chars each
    // we'd hit the forbidden set within a few iterations if it were
    // present. Guards against a future well-meaning change to the
    // alphabet accidentally re-introducing look-alike characters.
    for (let i = 0; i < 500; i++) {
      const suffix = generatePermitDisplayId().slice(4);
      expect(suffix).not.toMatch(/[IO01]/);
    }
  });

  it("yields high entropy over many draws (no obvious collision cluster)", () => {
    // 500 draws from a 32-char alphabet at 8 chars = 32^8 space. Any
    // collision here means the generator is broken.
    const set = new Set<string>();
    for (let i = 0; i < 500; i++) set.add(generatePermitDisplayId());
    expect(set.size).toBe(500);
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
