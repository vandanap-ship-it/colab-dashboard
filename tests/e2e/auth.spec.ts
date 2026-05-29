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

  test("deactivating a user drops their existing session on the next request", async ({
    page,
    browser,
  }) => {
    // Target = the lightly-used product-team account, so this can't disturb the
    // other specs. The dev server runs with AUTH_REVALIDATE_MS=0 so the session
    // is re-checked against the DB every request (no 60s throttle).
    await signIn(page, "product");
    expect((await page.request.get("/api/projects")).status()).toBe(200);

    const sess = await (await page.request.get("/api/auth/session")).json();
    const targetId = sess?.user?.id as string;
    expect(targetId, "session should expose the user id").toBeTruthy();

    const adminCtx = await browser.newContext();
    try {
      const adminPage = await adminCtx.newPage();
      await signIn(adminPage, "admin");
      const deactivated = await adminPage.request.patch(`/api/admin/users/${targetId}`, {
        data: { active: false },
      });
      expect(deactivated.ok()).toBeTruthy();

      // The target's next request re-validates, finds the user inactive, and is
      // denied — even though their JWT hasn't expired.
      expect((await page.request.get("/api/projects")).status()).toBe(401);
    } finally {
      // Always reactivate so the shared seed DB is left exactly as we found it.
      const cleanupPage = await adminCtx.newPage();
      await signIn(cleanupPage, "admin");
      await cleanupPage.request.patch(`/api/admin/users/${targetId}`, {
        data: { active: true },
      });
      await adminCtx.close();
    }
  });
});
