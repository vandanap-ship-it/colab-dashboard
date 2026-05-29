import { describe, it, expect } from "vitest";
import { refreshTokenFromDb, type DbUserSnapshot } from "@/lib/authToken";

const baseToken = {
  id: "u1",
  role: "SITE_ENGINEER",
  username: "engineer",
  modules: null as string | null,
  validatedAt: 0,
};

const activeUser: DbUserSnapshot = {
  active: true,
  role: "PLANNER",
  username: "engineer",
  modules: '["QAQC"]',
};

describe("refreshTokenFromDb", () => {
  it("refreshes role/modules from the DB for an active user", async () => {
    const out = await refreshTokenFromDb(baseToken, async () => activeUser, {
      now: 100_000,
      intervalMs: 60_000,
    });
    expect(out).not.toBeNull();
    expect(out!.role).toBe("PLANNER"); // role change propagated
    expect(out!.modules).toBe('["QAQC"]'); // module change propagated
    expect(out!.validatedAt).toBe(100_000); // stamp updated
  });

  it("drops the session (null) when the user is deactivated", async () => {
    const out = await refreshTokenFromDb(
      baseToken,
      async () => ({ ...activeUser, active: false }),
      { now: 100_000 },
    );
    expect(out).toBeNull();
  });

  it("drops the session (null) when the user no longer exists", async () => {
    const out = await refreshTokenFromDb(baseToken, async () => null, { now: 100_000 });
    expect(out).toBeNull();
  });

  it("keeps the existing token on a transient loader error (fail-open)", async () => {
    const out = await refreshTokenFromDb(
      baseToken,
      async () => {
        throw new Error("db unreachable");
      },
      { now: 100_000 },
    );
    expect(out).toBe(baseToken); // unchanged — no mass logout on a DB blip
  });

  it("skips the DB check inside the throttle window", async () => {
    let called = false;
    const token = { ...baseToken, validatedAt: 100_000 };
    const out = await refreshTokenFromDb(
      token,
      async () => {
        called = true;
        return activeUser;
      },
      { now: 130_000, intervalMs: 60_000 }, // only 30s elapsed
    );
    expect(called).toBe(false); // no DB hit
    expect(out).toBe(token); // unchanged
  });

  it("re-checks once the throttle window has passed", async () => {
    let called = false;
    const token = { ...baseToken, validatedAt: 100_000 };
    const out = await refreshTokenFromDb(
      token,
      async () => {
        called = true;
        return activeUser;
      },
      { now: 100_000 + 60_001, intervalMs: 60_000 },
    );
    expect(called).toBe(true);
    expect(out).not.toBeNull();
    expect(out!.role).toBe("PLANNER");
  });

  it("returns the token unchanged when it has no id", async () => {
    const token = { role: "X" } as { id?: unknown; role?: string };
    const out = await refreshTokenFromDb(token, async () => activeUser, { now: 100_000 });
    expect(out).toBe(token);
  });
});
