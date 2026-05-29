import { test, expect, signIn, getProjectId, uniqueId } from "./fixtures";
import type { Page } from "@playwright/test";

async function aContractorId(page: Page, projectId: string): Promise<string | null> {
  const res = await page.request.get(`/api/projects/${projectId}/wbs?leaves=true`);
  const nodes = (await res.json()).nodes as Array<{ contractor?: { id: string } | null }>;
  return nodes.find((n) => n.contractor)?.contractor?.id ?? null;
}

test.describe("Sub-contractor billing", () => {
  test("API: planner drafts + submits, manager approves; total computed", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const contractorId = await aContractorId(page, projectId);
    expect(contractorId, "seed should assign a contractor to some activity").toBeTruthy();

    // item-rate (10 × 100 = 1000) + lump-sum (5000), 18% tax.
    const createRes = await page.request.post("/api/bills", {
      data: {
        projectId,
        contractorId,
        title: `[E2E] RA Bill ${uniqueId()}`,
        taxPercent: 18,
        lines: [
          { type: "ITEM_RATE", description: "Concrete", quantity: 10, rate: 100, unit: "m3" },
          { type: "LUMP_SUM", description: "Mobilisation", amount: 5000 },
        ],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const bill = (await createRes.json()).bill;
    expect(bill.status).toBe("DRAFT");
    expect(bill.subtotal).toBe(6000);
    expect(bill.tax).toBe(1080); // 6000 × 18%
    expect(bill.total).toBe(7080);

    // Submit (preparer).
    const submitRes = await page.request.patch(`/api/bills/${bill.id}`, { data: { status: "SUBMITTED" } });
    expect(submitRes.ok()).toBeTruthy();
    expect((await submitRes.json()).bill.status).toBe("SUBMITTED");

    // A planner can't approve (separation of duties — that's a Manager/Admin step).
    const selfApprove = await page.request.patch(`/api/bills/${bill.id}`, { data: { status: "APPROVED" } });
    expect(selfApprove.status()).toBe(403);

    // Manager approves.
    await page.context().clearCookies();
    await signIn(page, "manager");
    const approveRes = await page.request.patch(`/api/bills/${bill.id}`, { data: { status: "APPROVED" } });
    expect(approveRes.ok()).toBeTruthy();
    const approved = (await approveRes.json()).bill;
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy?.id).toBeTruthy();
  });

  test("API: a site engineer cannot create bills", async ({ page }) => {
    await signIn(page, "engineer");
    const projectId = await getProjectId(page);
    const res = await page.request.post("/api/bills", {
      data: { projectId, contractorId: "x", title: "nope", lines: [] },
    });
    expect(res.status()).toBe(403);
  });

  test("API: an illegal status jump (draft → approved) is rejected", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);
    const contractorId = await aContractorId(page, projectId);
    const createRes = await page.request.post("/api/bills", {
      data: {
        projectId,
        contractorId,
        title: `[E2E] Jump ${uniqueId()}`,
        lines: [{ type: "LUMP_SUM", description: "x", amount: 100 }],
      },
    });
    const bill = (await createRes.json()).bill;
    // Can't skip submission.
    const res = await page.request.patch(`/api/bills/${bill.id}`, { data: { status: "APPROVED" } });
    expect(res.status()).toBe(400);
  });

  test("UI: planner creates a bill through the form and sees it listed", async ({ page }) => {
    await signIn(page, "planner");
    const projectId = await getProjectId(page);

    await page.goto(`/projects/${projectId}/bills`);
    await expect(page.getByRole("heading", { name: /Sub-Contractor Billing/i })).toBeVisible();

    await page.getByRole("button", { name: /New bill/i }).click();
    const title = `[E2E UI] Bill ${uniqueId()}`;
    await page.getByPlaceholder("e.g. June RA Bill").fill(title);
    // The first line defaults to "Lump sum" — its amount is the first number input.
    await page.locator('input[type="number"]').first().fill("5000");
    await page.getByRole("button", { name: /Create bill/i }).click();

    // Back in the list, the new bill appears with its total.
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("₹5,000").first()).toBeVisible();
  });
});
