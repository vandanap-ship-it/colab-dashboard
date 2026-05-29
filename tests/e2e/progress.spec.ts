import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

test.describe("Progress entry workflow", () => {
  test("API: manager can create a progress entry", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // Find an activity
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const wbsData = await wbsRes.json();
    const activity = wbsData.nodes?.[0];
    expect(activity).toBeTruthy();

    // Create the entry
    const note = `[E2E test] Progress note ${uniqueId()}`;
    const createRes = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 5,
        cumulativeQuantity: 5,
        notes: note,
        labour: [{ category: "Skilled", count: 3 }],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { entry } = await createRes.json();
    expect(entry.id).toBeTruthy();
    expect(entry.notes).toBe(note);
  });

  test("API: logging progress marks the activity tracked + recomputes %", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // Need a leaf with a totalQuantity so cumulative → percentComplete fires.
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const nodes = (await wbsRes.json()).nodes as Array<{ id: string; totalQuantity: number | null }>;
    const activity = nodes.find((n) => n.totalQuantity && n.totalQuantity > 0);
    expect(activity, "seed should include a leaf with a totalQuantity").toBeTruthy();

    // Cumulative === total → 100% complete.
    const createRes = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity!.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 1,
        cumulativeQuantity: activity!.totalQuantity,
        notes: `[E2E tracked test] ${uniqueId()}`,
      },
    });
    expect(createRes.ok()).toBeTruthy();

    // Activity must now be tracked (so it counts in the dashboard rollup), at
    // 100%, with actualFinish stamped. progressEntered=true is the fix that
    // stops freshly-logged activities from being dropped from project stats.
    const detailRes = await page.request.get(`/api/projects/${projectId}/wbs/${activity!.id}`);
    expect(detailRes.ok()).toBeTruthy();
    const node = (await detailRes.json()).node as {
      percentComplete: number;
      progressEntered: boolean;
      actualFinish: string | null;
    };
    expect(node.progressEntered).toBe(true);
    expect(node.percentComplete).toBe(100);
    expect(node.actualFinish).toBeTruthy();
  });

  test("API: progress rejects a contractor that isn't in this project", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const activity = (await wbsRes.json()).nodes?.[0];
    const res = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 1,
        cumulativeQuantity: 1,
        contractorId: "no-such-contractor-id",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("API: replaying the same idempotencyKey does not duplicate the entry", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const activity = (await wbsRes.json()).nodes?.[0];

    const key = `e2e-idem-${uniqueId()}`;
    const note = `[E2E idem] ${key}`;
    const payload = {
      idempotencyKey: key,
      wbsNodeId: activity.id,
      date: new Date().toISOString(),
      type: "LABOUR_SUPPLY",
      achievedQuantity: 2,
      cumulativeQuantity: 2,
      notes: note,
    };

    const first = await page.request.post("/api/progress", { data: payload });
    expect(first.ok()).toBeTruthy();
    const firstEntry = (await first.json()).entry;

    // Replay the exact same submission (simulates a lost-response retry).
    const second = await page.request.post("/api/progress", { data: payload });
    expect(second.ok()).toBeTruthy();
    const secondEntry = (await second.json()).entry;

    // Same record handed back — not a new one.
    expect(secondEntry.id).toBe(firstEntry.id);

    // And exactly one entry with this note exists.
    const listRes = await page.request.get(
      `/api/progress?projectId=${projectId}&wbsNodeId=${activity.id}`,
    );
    const entries = (await listRes.json()).entries as Array<{ notes: string | null }>;
    expect(entries.filter((e) => e.notes === note).length).toBe(1);
  });

  test("Soft delete: progress entry goes to trash, admin can restore", async ({ page }) => {
    await signIn(page, "manager");
    const projectId = await getProjectId(page);

    // Create an entry to delete
    const wbsRes = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
    const activity = (await wbsRes.json()).nodes?.[0];
    const note = `[E2E delete test] ${uniqueId()}`;
    const createRes = await page.request.post("/api/progress", {
      data: {
        wbsNodeId: activity.id,
        date: new Date().toISOString(),
        type: "LABOUR_SUPPLY",
        achievedQuantity: 1,
        cumulativeQuantity: 1,
        notes: note,
      },
    });
    const { entry } = await createRes.json();

    // Delete it
    const delRes = await page.request.delete(`/api/progress/${entry.id}`);
    expect(delRes.ok()).toBeTruthy();

    // Confirm it's not in normal listing
    const listRes = await page.request.get(`/api/progress?projectId=${projectId}`);
    const listData = await listRes.json();
    const stillVisible = listData.entries.find((e: { id: string }) => e.id === entry.id);
    expect(stillVisible).toBeUndefined();

    // Sign in as admin and restore
    await page.context().clearCookies();
    await signIn(page, "admin");
    const restoreRes = await page.request.post("/api/admin/restore", {
      data: { entityType: "ProgressEntry", id: entry.id },
    });
    expect(restoreRes.ok()).toBeTruthy();

    // Confirm it's back
    const listAfterRes = await page.request.get(`/api/progress?projectId=${projectId}`);
    const listAfter = await listAfterRes.json();
    const restored = listAfter.entries.find((e: { id: string }) => e.id === entry.id);
    expect(restored).toBeTruthy();
  });
});
