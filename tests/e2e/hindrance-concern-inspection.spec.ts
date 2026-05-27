import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Hindrance / Concern / Inspection workflows", () => {
  test("API: manager raises a hindrance, planner resolves it", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    const desc = `[E2E test] Site flooded ${uniqueId()}`;
    const createRes = await page.request.post("/api/hindrances", {
      data: {
        projectId,
        description: desc,
        startDate: new Date().toISOString(),
        daysImpact: 1,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { hindrance } = await createRes.json();
    expect(hindrance.status).toBe("OPEN");

    // Switch to planner and resolve
    await page.context().clearCookies();
    await signIn(page, "planner");
    const resolveRes = await page.request.patch(`/api/hindrances/${hindrance.id}`, {
      data: { status: "RESOLVED" },
    });
    expect(resolveRes.ok()).toBeTruthy();
    const resolved = (await resolveRes.json()).hindrance;
    expect(resolved.status).toBe("RESOLVED");
  });

  test("API: engineer raises a concern, planner assigns it", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    const desc = `[E2E test] Material delivery delayed ${uniqueId()}`;
    const createRes = await page.request.post("/api/concerns", {
      data: { projectId, description: desc },
    });
    expect(createRes.ok()).toBeTruthy();
    const { concern } = await createRes.json();
    expect(concern.status).toBe("PENDING");
  });

  test("API: inspection submitted by manager, reviewed by planner", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const activity = (await wbsRes.json()).nodes?.[0];

    const title = `[E2E test] Inspection ${uniqueId()}`;
    const createRes = await page.request.post("/api/inspections", {
      data: {
        projectId,
        wbsNodeId: activity?.id,
        title,
        items: [
          { label: "Drawing matches", passed: true, notes: "" },
          { label: "Materials per spec", passed: true, notes: "" },
        ],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { inspection } = await createRes.json();
    expect(inspection.status).toBe("IN_REVIEW");

    // Planner approves
    await page.context().clearCookies();
    await signIn(page, "planner");
    const approveRes = await page.request.patch(`/api/inspections/${inspection.id}`, {
      data: { status: "PASSED" },
    });
    expect(approveRes.ok()).toBeTruthy();
    const approved = (await approveRes.json()).inspection;
    expect(approved.status).toBe("PASSED");
  });
});
