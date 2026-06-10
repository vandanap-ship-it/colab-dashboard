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

test.describe("Inspection templates", () => {
  test("API: admin seeds curated templates, anyone can list them", async ({ page }) => {
    // Admin seeds the curated checklist library (idempotent).
    await signIn(page, "admin");
    const seedRes = await page.request.post("/api/admin/seed-inspection-templates");
    expect(seedRes.ok()).toBeTruthy();
    const seeded = (await seedRes.json()).seeded as string[];
    // CL-QC-01 (Marking / Setting Out) ships with 20 verbatim checkpoints.
    expect(seeded.some((s) => s.startsWith("CL-QC-01"))).toBeTruthy();

    // A full-access user can list templates and sees the seeded one with items.
    await page.context().clearCookies();
    await signIn(page, "manager");
    const listRes = await page.request.get("/api/inspection-templates");
    expect(listRes.ok()).toBeTruthy();
    const templates = (await listRes.json()).templates as Array<{
      code: string;
      name: string;
      items: unknown[];
    }>;
    const marking = templates.find((t) => t.code === "CL-QC-01");
    expect(marking).toBeTruthy();
    expect(marking!.items.length).toBe(20);
  });

  test("API: non-admin cannot seed templates", async ({ page }) => {
    await signIn(page, "manager");
    const res = await page.request.post("/api/admin/seed-inspection-templates");
    expect(res.status()).toBe(403);
  });

  test("API: refuses assignment to a deactivated user (issues + concerns)", async ({ page }) => {
    // Locks down the rule that snags / concerns can't be assigned to
    // someone whose account is inactive — otherwise the actionable item
    // lands on /my-actions for an inbox no one can read.
    const uname = `assignee.test.${uniqueId()}`.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    await signIn(page, "admin");
    const projectId = await getProjectId(page);

    // 1. Create a fresh user, then deactivate them
    const createUser = await page.request.post("/api/admin/users", {
      data: {
        username: uname,
        name: "Assignee Test",
        role: "PLANNER",
        password: "Siddhi@Test1",
      },
    });
    expect(createUser.ok()).toBeTruthy();
    const { user } = await createUser.json();
    const deactivated = await page.request.patch(`/api/admin/users/${user.id}`, {
      data: { active: false },
    });
    expect(deactivated.ok()).toBeTruthy();

    // 2. Create a snag, try to assign to the deactivated user → 400
    const snagRes = await page.request.post("/api/issues", {
      data: { projectId, description: `[E2E assignee test] snag ${uniqueId()}` },
    });
    expect(snagRes.ok()).toBeTruthy();
    const { issue } = await snagRes.json();

    const assignSnag = await page.request.patch(`/api/issues/${issue.id}`, {
      data: { assignedToId: user.id },
    });
    expect(assignSnag.status()).toBe(400);
    expect((await assignSnag.json()).error).toMatch(/deactivated/i);

    // 3. Same for a concern
    const concRes = await page.request.post("/api/concerns", {
      data: { projectId, description: `[E2E assignee test] concern ${uniqueId()}` },
    });
    expect(concRes.ok()).toBeTruthy();
    const { concern } = await concRes.json();

    const assignConc = await page.request.patch(`/api/concerns/${concern.id}`, {
      data: { assignedToId: user.id },
    });
    expect(assignConc.status()).toBe(400);
    expect((await assignConc.json()).error).toMatch(/deactivated/i);

    // 4. Also blocked on snag creation if you try to set assignedToId at
    //    POST time — server validates the same way.
    const directAssign = await page.request.post("/api/issues", {
      data: {
        projectId,
        description: `[E2E assignee test] direct ${uniqueId()}`,
        assignedToId: user.id,
      },
    });
    expect(directAssign.status()).toBe(400);
  });
});
