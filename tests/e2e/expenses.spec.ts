import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";

async function logExpense(page: import("@playwright/test").Page, projectId: string, over: Record<string, unknown> = {}) {
  return page.request.post("/api/expenses", {
    data: {
      projectId,
      category: "Materials",
      description: `[E2E] Cement ${uniqueId()}`,
      amount: 5000,
      date: new Date().toISOString(),
      paidTo: "Vendor A",
      ...over,
    },
  });
}

test.describe("Project expenses", () => {
  test("API: site engineer logs, manager approves", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const createRes = await logExpense(page, projectId);
    expect(createRes.status()).toBe(201);
    const expense = (await createRes.json()).expense;
    expect(expense.status).toBe("SUBMITTED");
    expect(expense.category).toBe("Materials");
    expect(expense.amount).toBe(5000);

    await page.context().clearCookies();
    await signIn(page, "manager");
    const approveRes = await page.request.patch(`/api/expenses/${expense.id}`, { data: { status: "APPROVED" } });
    expect(approveRes.ok()).toBeTruthy();
    const approved = (await approveRes.json()).expense;
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy?.id).toBeTruthy();
  });

  test("API: reject with reason, logger resubmits", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const expense = (await (await logExpense(page, projectId)).json()).expense;

    await page.context().clearCookies();
    await signIn(page, "manager");
    const rejectRes = await page.request.patch(`/api/expenses/${expense.id}`, {
      data: { status: "REJECTED", rejectionReason: "No receipt attached" },
    });
    const rejected = (await rejectRes.json()).expense;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("No receipt attached");

    await page.context().clearCookies();
    await signIn(page, "engineer");
    const resubmitRes = await page.request.patch(`/api/expenses/${expense.id}`, { data: { status: "SUBMITTED" } });
    const resubmitted = (await resubmitRes.json()).expense;
    expect(resubmitted.status).toBe("SUBMITTED");
    expect(resubmitted.rejectionReason).toBeNull();
  });

  test("API: a non-positive amount is rejected", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const res = await logExpense(page, projectId, { amount: 0 });
    expect(res.status()).toBe(400);
  });

  test("API: an approved expense cannot be deleted", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const expense = (await (await logExpense(page, projectId)).json()).expense;

    await page.context().clearCookies();
    await signIn(page, "manager");
    await page.request.patch(`/api/expenses/${expense.id}`, { data: { status: "APPROVED" } });

    // The logger normally can trash their own, but not once it's approved.
    await page.context().clearCookies();
    await signIn(page, "engineer");
    const delRes = await page.request.delete(`/api/expenses/${expense.id}`);
    expect(delRes.status()).toBe(400);
  });

  test("API: a scoped contractor cannot log expenses", async ({ page }) => {
    const uname = `exp.scoped.${uniqueId()}`.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const PASS = "Siddhi@Test1";
    await signIn(page, "admin");
    const projectId = await getProjectId(page);
    const createRes = await page.request.post("/api/admin/users", {
      data: {
        username: uname,
        name: "Scoped Expense Tester",
        role: "SITE_ENGINEER",
        password: PASS,
        designation: "QA/QC Contractor",
        modules: ["QAQC"],
      },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill('input[autocomplete="username"]', uname);
    await page.fill('input[autocomplete="current-password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle").catch(() => {});

    // Role is SITE_ENGINEER (which can normally log), but the QAQC module scope
    // locks them out of project P2P entirely.
    const res = await logExpense(page, projectId);
    expect(res.status()).toBe(403);
  });
});
