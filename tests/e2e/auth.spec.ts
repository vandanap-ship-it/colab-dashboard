import { test, expect, signIn } from "./fixtures";

test.describe("Authentication", () => {
  test("unauthenticated user gets redirected to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login as admin lands on a desktop view", async ({ page }) => {
    await signIn(page, "admin");
    // Admin should see the desktop top nav (Users / Contractors / Audit / Trash links)
    await expect(page.getByRole("link", { name: /^Users/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Audit/i })).toBeVisible();
  });

  test("login as planner lands on a desktop view", async ({ page }) => {
    await signIn(page, "planner");
    // Planner shouldn't see admin-only links
    await expect(page.getByRole("link", { name: /^Users$/i })).toHaveCount(0);
  });

  test("login as engineer lands on mobile", async ({ page }) => {
    await signIn(page, "engineer");
    await expect(page).toHaveURL(/\/mobile/);
  });

  test("invalid credentials are rejected", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[autocomplete="username"]', "admin");
    await page.fill('input[autocomplete="current-password"]', "wrong-password");
    await page.click('button[type="submit"]');
    // Should stay on login (or show error). Either way, not navigated to /.
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/login/);
  });
});
