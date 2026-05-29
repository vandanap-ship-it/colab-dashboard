import { describe, it, expect } from "vitest";
import { classifyResponse, nextDelay } from "@/lib/offlineQueue";

describe("classifyResponse", () => {
  it("removes on 2xx success", () => {
    expect(classifyResponse(200)).toBe("remove");
    expect(classifyResponse(201)).toBe("remove");
    expect(classifyResponse(204)).toBe("remove");
  });

  it("retries on 5xx server errors", () => {
    expect(classifyResponse(500)).toBe("retry");
    expect(classifyResponse(502)).toBe("retry");
    expect(classifyResponse(503)).toBe("retry");
  });

  it("retries on 401 (expired session), 408 and 429 (transient)", () => {
    // The fix: an expired session must keep retrying (after re-auth), not park.
    expect(classifyResponse(401)).toBe("retry");
    expect(classifyResponse(408)).toBe("retry");
    expect(classifyResponse(429)).toBe("retry");
  });

  it("parks other 4xx that won't fix themselves", () => {
    expect(classifyResponse(400)).toBe("park"); // validation
    expect(classifyResponse(403)).toBe("park"); // permission
    expect(classifyResponse(404)).toBe("park"); // gone
    expect(classifyResponse(409)).toBe("park"); // conflict
    expect(classifyResponse(422)).toBe("park"); // unprocessable
  });
});

describe("nextDelay", () => {
  it("backs off exponentially from 5s", () => {
    expect(nextDelay(1)).toBe(5_000);
    expect(nextDelay(2)).toBe(10_000);
    expect(nextDelay(3)).toBe(20_000);
    expect(nextDelay(4)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(nextDelay(7)).toBe(300_000);
    expect(nextDelay(20)).toBe(300_000);
  });
});
