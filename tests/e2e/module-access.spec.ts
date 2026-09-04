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

      // 6. Hindrance create — BLOCKED (403)
      const hindRes = await page.request.post("/api/hindrances", {
        data: { projectId, description: "blocked", startDate: new Date().toISOString() },
      });
      expect(hindRes.status()).toBe(403);

      // 6b. Concern create — BLOCKED (403)
      const concRes = await page.request.post("/api/concerns", {
        data: { projectId, description: "blocked too" },
      });
      expect(concRes.status()).toBe(403);

      // 7. Schedule — empty (no access)
      const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
      const wbsData = await wbsRes.json();
      expect(wbsData.nodes).toEqual([]);

      // 8. Read access to other modules is also scoped — a QAQC contractor
      //    must not be able to READ progress / hindrances / concerns.
      const progList = await page.request.get(`/api/progress?projectId=${projectId}`);
      expect((await progList.json()).entries).toEqual([]);

      const hindList = await page.request.get(`/api/hindrances?projectId=${projectId}`);
      expect((await hindList.json()).hindrances).toEqual([]);

      const concList = await page.request.get(`/api/concerns?projectId=${projectId}`);
      expect((await concList.json()).concerns).toEqual([]);

      // 9. Single-record endpoints must also be locked down (no IDOR around
      //    the list-level scoping). These guards run before any DB lookup,
      //    so arbitrary IDs still return 403.
      const nodeDetail = await page.request.get(
        `/api/projects/${projectId}/wbs/any-node-id`,
      );
      expect(nodeDetail.status()).toBe(403);

      const insights = await page.request.get(`/api/projects/${projectId}/insights`);
      expect(insights.status()).toBe(403);

      const hindPatch = await page.request.patch("/api/hindrances/any-id", {
        data: { status: "OPEN" },
      });
      expect(hindPatch.status()).toBe(403);

      const concPatch = await page.request.patch("/api/concerns/any-id", {
        data: { status: "READ" },
      });
      expect(concPatch.status()).toBe(403);

      // 10. Drawing Register is internal-only — both list + detail must reject
      //     a scoped contractor (same guard the write endpoints already had).
      const drawList = await page.request.get(`/api/drawings?projectId=${projectId}`);
      expect(drawList.status()).toBe(403);
      const drawDetail = await page.request.get(`/api/drawings/any-id`);
      expect(drawDetail.status()).toBe(403);

      // 11. /api/projects returns a REDUCED shape for scoped contractors —
      //     they need the picker but must not see addresses or dates.
      const projRes = await page.request.get("/api/projects");
      expect(projRes.status()).toBe(200);
      const projJson = (await projRes.json()) as {
        projects: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(projJson.projects)).toBe(true);
      // The scoped shape has id/name/code/status only — no createdBy/address/dates.
      for (const p of projJson.projects) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(p.createdBy).toBeUndefined();
        expect(p.address).toBeUndefined();
        expect(p.startDate).toBeUndefined();
        expect(p.endDate).toBeUndefined();
      }

      // 12. /api/admin/contractors GET:
      //     - without projectId → admin only (rejects scoped user)
      //     - with projectId → any signed-in user (mobile progress form needs this)
      const allContractorsRes = await page.request.get("/api/admin/contractors");
      expect(allContractorsRes.status()).toBe(403);
      const scopedContractorsRes = await page.request.get(
        `/api/admin/contractors?projectId=${projectId}`,
      );
      expect(scopedContractorsRes.status()).toBe(200);

      // 13. /api/users — internal-only assignee picker. A scoped contractor
      //     used to be able to enumerate every user's id / name / role.
      const usersListRes = await page.request.get("/api/users");
      expect(usersListRes.status()).toBe(403);

      // 14. /api/projects/summary — portfolio rollup with delay days, labour,
      //     financial progress. Scoped contractors have no legitimate reason
      //     for a cross-project view.
      const summaryRes = await page.request.get("/api/projects/summary");
      expect(summaryRes.status()).toBe(403);

      // 15. /api/projects/[id]/trade-plans — planned headcount per subcontractor
      //     is planning-side data. A QAQC-scoped user has no PROGRESS module.
      const tradePlansRes = await page.request.get(`/api/projects/${projectId}/trade-plans`);
      expect(tradePlansRes.status()).toBe(403);

      // 16. /api/projects/[id]/activities/for-milestone/[id] — leaf activities
      //     for the mobile picker. Same PROGRESS gate as the sibling wbs and
      //     picker routes.
      const forMilestoneRes = await page.request.get(
        `/api/projects/${projectId}/activities/for-milestone/any-milestone-id`,
      );
      expect(forMilestoneRes.status()).toBe(403);

      // 17. /api/expenses/[id] PATCH + DELETE — internal-only. The list and
      //     GET routes already gated on isScopedUser; the mutate paths did not.
      //     Any id is fine — the gate runs before the DB lookup.
      const expPatchRes = await page.request.patch("/api/expenses/any-id", {
        data: { status: "APPROVED" },
      });
      expect(expPatchRes.status()).toBe(403);
      const expDeleteRes = await page.request.delete("/api/expenses/any-id");
      expect(expDeleteRes.status()).toBe(403);
    } finally {
      // 8. Cleanup — deactivate the test user as admin
      await page.context().clearCookies();
      await signIn(page, "admin");
      await page.request.patch(`/api/admin/users/${user.id}`, {
        data: { active: false },
      });
    }
  });

  test("QAQC-scoped contractor cannot touch a general (null-module) snag or inspection", async ({ page }) => {
    // Regression guard for canAccessScopedRow: an internal user (admin) posts
    // a snag / inspection with module=null (general). A scoped contractor
    // must not be able to PATCH or DELETE those rows even by direct id.
    const uname = `qaqc.crossmod.${Date.now()}`.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const PASS = "Siddhi@Test1";

    await signIn(page, "admin");
    const projectId = await getProjectId(page);

    // 1. Admin creates a general snag + general inspection (module=null).
    const adminSnag = await page.request.post("/api/issues", {
      data: { projectId, description: `[cross-mod fk test] general snag ${uniqueId()}` },
    });
    expect(adminSnag.status()).toBe(201);
    const { issue: adminSnagRow } = await adminSnag.json();
    expect(adminSnagRow.module).toBeNull();

    const adminInsp = await page.request.post("/api/inspections", {
      data: {
        projectId,
        title: `[cross-mod fk test] general inspection ${uniqueId()}`,
        items: [{ label: "Check", passed: true }],
      },
    });
    expect(adminInsp.status()).toBe(201);
    const { inspection: adminInspRow } = await adminInsp.json();
    expect(adminInspRow.module).toBeNull();

    // 2. Admin provisions a QAQC-scoped contractor.
    const createRes = await page.request.post("/api/admin/users", {
      data: {
        username: uname,
        name: "QAQC Cross-Module Test",
        role: "SITE_ENGINEER",
        password: PASS,
        designation: "QA/QC Contractor",
        modules: ["QAQC"],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { user } = await createRes.json();

    try {
      await page.context().clearCookies();
      await page.goto("/login");
      await page.fill('input[autocomplete="username"]', uname);
      await page.fill('input[autocomplete="current-password"]', PASS);
      await page.click('button[type="submit"]');
      await page.waitForLoadState("networkidle");

      // 3. Scoped user cannot PATCH admin's null-module snag.
      const snagPatch = await page.request.patch(`/api/issues/${adminSnagRow.id}`, {
        data: { status: "RESOLVED" },
      });
      expect(snagPatch.status()).toBe(403);

      // 4. Scoped user cannot DELETE it either.
      const snagDelete = await page.request.delete(`/api/issues/${adminSnagRow.id}`);
      expect(snagDelete.status()).toBe(403);

      // 5. Same guard on inspection PATCH.
      const inspPatch = await page.request.patch(`/api/inspections/${adminInspRow.id}`, {
        data: { status: "PASSED" },
      });
      expect(inspPatch.status()).toBe(403);
      const inspDelete = await page.request.delete(`/api/inspections/${adminInspRow.id}`);
      expect(inspDelete.status()).toBe(403);
    } finally {
      // Cleanup: deactivate scoped user; delete the test rows.
      await page.context().clearCookies();
      await signIn(page, "admin");
      await page.request.patch(`/api/admin/users/${user.id}`, { data: { active: false } });
      await page.request.delete(`/api/issues/${adminSnagRow.id}`);
      await page.request.delete(`/api/inspections/${adminInspRow.id}`);
    }
  });
});
