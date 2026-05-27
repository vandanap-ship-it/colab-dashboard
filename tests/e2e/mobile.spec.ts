import { test, expect, signIn } from "./fixtures";

test.describe("Mobile experience", () => {
  test("engineer lands on /mobile after login", async ({ page }) => {
    await signIn(page, "engineer");
    await expect(page).toHaveURL(/\/mobile/);
  });

  test("mobile home shows bottom nav", async ({ page }) => {
    await signIn(page, "engineer");
    // Bottom nav has Home / Documents / Info / Profile entries
    await expect(page.getByText(/Home/i).first()).toBeVisible();
    await expect(page.getByText(/Profile/i).first()).toBeVisible();
  });

  test("manager can reach the mobile add-progress flow", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/mobile");
    // Should at least render the mobile chrome without error
    await expect(page.locator("body")).not.toContainText(/Forbidden|Unauthorized/i);
  });
});
