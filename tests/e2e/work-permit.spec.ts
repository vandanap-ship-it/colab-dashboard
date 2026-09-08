import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

/**
 * End-to-end coverage for the work-permit lifecycle. Exercises the real
 * `/api/work-permits` handlers through Playwright's request client so the
 * state machine, authorization, and cross-project guards run against the
 * live schema. UI tests are covered by the sanity mobile-page load at the
 * bottom — the interactive flow lives in the API tests where invariants
 * are easier to assert.
 */

type UserRow = { id: string; name: string; username: string; role: string };

async function findUserByUsername(page: import("@playwright/test").Page, username: string): Promise<UserRow> {
  const res = await page.request.get("/api/users");
  expect(res.ok()).toBeTruthy();
  const { users } = (await res.json()) as { users: UserRow[] };
  const u = users.find((x) => x.username === username);
  if (!u) throw new Error(`No user with username "${username}" in seeded data`);
  return u;
}

test.describe("Work permit workflow", () => {
  test("engineer raises permit, planner approves, engineer closes", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const planner = await findUserByUsername(page, "planner");

    // 1. Engineer raises a General work permit with planner as approver.
    const title = `[E2E] General permit ${uniqueId()}`;
    const createRes = await page.request.post("/api/work-permits", {
      data: {
        projectId,
        type: "GENERAL",
        title,
        description: "Test permit raised from Playwright",
        workDate: "2026-09-10",
        startTime: "09:00",
        endTime: "18:00",
        location: "Villa 14 / Ground Floor",
        approverIds: [planner.id],
      },
    });
    expect(createRes.status()).toBe(201);
    const { workPermit } = await createRes.json();
    expect(workPermit.id).toBeTruthy();
    expect(workPermit.status).toBe("PENDING");
    expect(workPermit.title).toBe(title);

    // 2. Requester CANNOT approve their own permit.
    const selfApproveRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "APPROVED" },
    });
    expect(selfApproveRes.status()).toBe(403);

    // 3. Illegal PENDING → CLOSED jump is blocked by the state machine.
    const skipCloseRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "CLOSED" },
    });
    expect(skipCloseRes.status()).toBe(400);

    // 4. Planner approves.
    await page.context().clearCookies();
    await signIn(page, "planner");
    const approveRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "APPROVED" },
    });
    expect(approveRes.ok()).toBeTruthy();
    const approved = (await approveRes.json()).workPermit;
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(planner.id);
    expect(approved.approvedAt).toBeTruthy();

    // 5. Engineer (requester) closes at end of day.
    await page.context().clearCookies();
    await signIn(page, "engineer");
    const closeRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "CLOSED" },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closed = (await closeRes.json()).workPermit;
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeTruthy();

    // Optimistic-lock stale write is rejected with 409.
    const staleRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: {
        status: "CLOSED",
        // A stale updatedAt (workPermit.updatedAt was the PENDING timestamp
        // captured way back in step 1).
        expectedUpdatedAt: workPermit.updatedAt,
      },
    });
    expect(staleRes.status()).toBe(409);
  });

  test("reject requires a reason and blocks close", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const planner = await findUserByUsername(page, "planner");

    const createRes = await page.request.post("/api/work-permits", {
      data: {
        projectId,
        type: "HOT_WORK",
        title: `[E2E] Reject test ${uniqueId()}`,
        workDate: "2026-09-10",
        startTime: "10:00",
        endTime: "14:00",
        approverIds: [planner.id],
      },
    });
    expect(createRes.status()).toBe(201);
    const { workPermit } = await createRes.json();

    await page.context().clearCookies();
    await signIn(page, "planner");

    // Empty reason → 400.
    const noReasonRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "REJECTED", rejectionReason: "" },
    });
    expect(noReasonRes.status()).toBe(400);

    // With reason → OK.
    const rejectRes = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "REJECTED", rejectionReason: "Fire watch not staffed" },
    });
    expect(rejectRes.ok()).toBeTruthy();
    const rejected = (await rejectRes.json()).workPermit;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Fire watch not staffed");

    // Rejected → CLOSED is illegal.
    const closeAfterReject = await page.request.patch(`/api/work-permits/${workPermit.id}`, {
      data: { status: "CLOSED" },
    });
    expect(closeAfterReject.status()).toBe(400);
  });

  test("permit validation catches malformed times and bad approvers", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const planner = await findUserByUsername(page, "planner");

    // Missing approverIds → 400.
    const noApproverRes = await page.request.post("/api/work-permits", {
      data: {
        projectId,
        type: "GENERAL",
        title: "Bad payload",
        workDate: "2026-09-10",
        startTime: "09:00",
        endTime: "18:00",
        approverIds: [],
      },
    });
    expect(noApproverRes.status()).toBe(400);

    // Bogus time format → 400.
    const badTimeRes = await page.request.post("/api/work-permits", {
      data: {
        projectId,
        type: "GENERAL",
        title: "Bad time",
        workDate: "2026-09-10",
        startTime: "9am",
        endTime: "6pm",
        approverIds: [planner.id],
      },
    });
    expect(badTimeRes.status()).toBe(400);

    // Fake approver id → 400.
    const fakeApproverRes = await page.request.post("/api/work-permits", {
      data: {
        projectId,
        type: "GENERAL",
        title: "Fake approver",
        workDate: "2026-09-10",
        startTime: "09:00",
        endTime: "18:00",
        approverIds: ["no-such-user-id"],
      },
    });
    expect(fakeApproverRes.status()).toBe(400);
  });

  test("mobile permit list page loads for engineer", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    await page.goto(`/mobile/${projectId}/permit`);
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });
});
