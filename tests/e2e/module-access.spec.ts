import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

/**
 * Module access control: external contractors are scoped to specific modules.
 * A QAQC-scoped contractor can raise inspections + snags, but cannot log
 * progress or browse the schedule.
 */
test.describe("Module access control", () => {
  test("QAQC-scoped contractor: inspections/snags allowed, progress + schedule blocked", async ({ page }) => {
    const uname = `qaqc.test.${uniqueId()}`.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const PASS = "Siddhi@Test1";

    // 1. Admin creates a QAQC-scoped contractor
    await signIn(page, "admin");
    const projectId = await getProjectId(page);
    const createRes = await page.request.post("/api/admin/users", {
      data: {
        username: uname,
        name: "QAQC Test Contractor",
        role: "SITE_ENGINEER",
        password: PASS,
        designation: "QA/QC Contractor",
        modules: ["QAQC"],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { user } = await createRes.json();
    expect(user.modules).toBe('["QAQC"]');

    try {
      // 2. Sign in as that contractor
      await page.context().clearCookies();
      await page.goto("/login");
      await page.fill('input[autocomplete="username"]', uname);
      await page.fill('input[autocomplete="current-password"]', PASS);
      await page.click('button[type="submit"]');
      await page.waitForLoadState("networkidle");

      // 3. Snag — allowed
      const snagRes = await page.request.post("/api/issues", {
        data: { projectId, description: `[scoped test] snag ${uniqueId()}` },
      });
      expect(snagRes.status()).toBe(201);
      const { issue } = await snagRes.json();
      expect(issue.module).toBe("QAQC");

      // 4. Inspection — allowed
      const inspRes = await page.request.post("/api/inspections", {
        data: {
          projectId,
          title: `[scoped test] inspection ${uniqueId()}`,
          items: [{ label: "Check 1", passed: true }],
        },
      });
      expect(inspRes.status()).toBe(201);
      const { inspection } = await inspRes.json();
      expect(inspection.module).toBe("QAQC");

      // 5. Progress — BLOCKED (403)
      const progRes = await page.request.post("/api/progress", {
        data: {
          wbsNodeId: "anything",
          date: new Date().toISOString(),
          achievedQuantity: 1,
          cumulativeQuantity: 1,
        },
      });
      expect(progRes.status()).toBe(403);

      // 6. Hindrance — BLOCKED (403)
      const hindRes = await page.request.post("/api/hindrances", {
        data: { projectId, description: "blocked", startDate: new Date().toISOString() },
      });
      expect(hindRes.status()).toBe(403);

      // 7. Schedule — empty (no access)
      const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
      const wbsData = await wbsRes.json();
      expect(wbsData.nodes).toEqual([]);
    } finally {
      // 8. Cleanup — deactivate the test user as admin
      await page.context().clearCookies();
      await signIn(page, "admin");
      await page.request.patch(`/api/admin/users/${user.id}`, {
        data: { active: false },
      });
    }
  });
});
