// One-off screenshot capture for the walkthrough artifact.
// Signs in as each persona at iPhone 14 Pro dimensions, screenshots
// the mobile home, saves to /tmp scratchpad.
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SHOTS_DIR = process.env.OUT_DIR ?? "/tmp/siddhi-persona-shots";
mkdirSync(SHOTS_DIR, { recursive: true });

const BASE = "https://siddhi-whitelotus.vercel.app";
const PASSWORD = "Wlg123";
const PERSONAS = [
  { username: "madhavarajan.s", label: "01-madhavarajan" },
  { username: "abhishek.m", label: "02-abhishek" },
  { username: "nagarjuna.c", label: "03-nagarjuna" },
  { username: "harish.bs", label: "04-harish" },
  { username: "thangamani.g", label: "05-thangamani" },
  { username: "girish.r", label: "06-girish" },
];

const iPhone = devices["iPhone 14 Pro"];

const browser = await chromium.launch();
const results = [];

for (const p of PERSONAS) {
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();
  try {
    // Pre-seed localStorage on the app origin so the first-run
    // onboarding overlay AND the "Add Siddhi to home screen" banner
    // both consider themselves dismissed before we navigate to the
    // authed home. Keys mirror MobileOnboarding + InstallPrompt.
    await page.goto(BASE);
    await page.evaluate(() => {
      try {
        localStorage.setItem("siddhi-mobile-onboarding-seen-v1", String(Date.now()));
        localStorage.setItem("siddhi-install-dismissed-at", String(Date.now()));
      } catch {}
    });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="text"]', p.username);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    // Wait for the mobile home to actually render — the "What's on
    // today?" hero copy appears only once the layout + tiles are up.
    await page.waitForSelector("text=What's on today?", { timeout: 15000 });
    await page.waitForTimeout(1200);
    const out = path.join(SHOTS_DIR, `${p.label}.png`);
    await page.screenshot({ path: out, fullPage: false });
    results.push({ ...p, ok: true, out });
    console.log(`ok  ${p.username} → ${out}`);
  } catch (e) {
    results.push({ ...p, ok: false, error: e.message });
    console.log(`err ${p.username}: ${e.message}`);
  }
  await ctx.close();
}

await browser.close();
console.log("\nSummary:");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.username}${r.ok ? "" : " · " + r.error}`);
}
