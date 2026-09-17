import { test as base, expect, Page } from "@playwright/test";

/**
 * Auth-aware test fixtures. Each role helper logs in as a seeded user and
 * returns the post-login page. The seed file creates these accounts:
 *
 *   admin    / password  → ADMIN
 *   planner  / password  → PLANNER
 *   product  / password  → PRODUCT_TEAM
 *   manager  / password  → SITE_MANAGER
 *   engineer / password  → SITE_ENGINEER
 */

export type Role = "admin" | "planner" | "product" | "manager" | "engineer";

export async function signIn(page: Page, role: Role): Promise<void> {
  await page.goto("/login");
  await page.fill('input[autocomplete="username"]', role);
  await page.fill('input[autocomplete="current-password"]', "password");
  await page.click('button[type="submit"]');
  // Login does a client push to "/", which then server-redirects by role
  // (e.g. engineers → /mobile). Wait for the navigation to actually leave
  // /login before continuing — networkidle alone can resolve mid-redirect on
  // slower CI runners.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  // Dismiss the mobile onboarding modal for the rest of the session so tests
  // don't trip on it. Safe on desktop paths — the flag is only read on
  // /mobile/* pages. Fails silently in Safari-private-mode-like environments.
  await page.evaluate(() => {
    try {
      localStorage.setItem("siddhi-mobile-onboarding-seen-v1", String(Date.now()));
    } catch {
      /* localStorage blocked — the onboarding is deliberately non-blocking too */
    }
  }).catch(() => {});
}

export async function getProjectId(page: Page, name = "Amanvana"): Promise<string> {
  const res = await page.request.get("/api/projects");
  const data = await res.json();
  const project = data.projects.find((p: { name: string; id: string }) =>
    p.name.toLowerCase().includes(name.toLowerCase()),
  );
  if (!project) throw new Error(`Project not found matching "${name}"`);
  return project.id;
}

/** Unique string suffix so tests don't collide across runs. */
export function uniqueId(prefix = ""): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const test = base.extend({});

export { expect };
