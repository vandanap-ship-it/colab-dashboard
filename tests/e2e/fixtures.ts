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
  // Wait for any post-login landing page (could be /, /mobile, etc.)
  await page.waitForLoadState("networkidle");
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
