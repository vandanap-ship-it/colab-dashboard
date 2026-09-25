// One-off audit: which villa milestones have zero leaf activities?
// Signs in as harish.bs (full-access planner) via Playwright, grabs
// the projectId from the redirect, walks the picker tree, and calls
// /api/projects/{id}/activities/for-milestone/{mid} for every villa
// milestone to check its child count.
//
// Output: a compact report grouped by villa, listing which milestone
// section is empty. Also a one-line summary of "N villas out of M
// have at least one empty milestone".
import { chromium, devices } from "@playwright/test";

const BASE = "https://siddhi-whitelotus.vercel.app";
const USER = "harish.bs";
const PASSWORD = "Wlg123";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14 Pro"] });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="text"]', USER);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
// Harish is full-access; he lands on the portfolio landing, not
// straight into a project. Navigate to the Amanvana mobile home by
// picking the first project from /api/projects/summary.
await page.waitForLoadState("networkidle");

const summary = await page.evaluate(async (base) => {
  const r = await fetch(`${base}/api/projects/summary`, { cache: "no-store" });
  return r.json();
}, BASE);
const project = summary.projects?.find((p) => /amanvana/i.test(p.name)) ?? summary.projects?.[0];
if (!project) throw new Error("No projects returned by /api/projects/summary");
console.log(`Project: ${project.name} (${project.id})\n`);

const picker = await page.evaluate(async ({ base, pid }) => {
  const r = await fetch(`${base}/api/projects/${pid}/activities/picker`, { cache: "no-store" });
  return r.json();
}, { base: BASE, pid: project.id });

// Flatten (villaKey, milestone) pairs so we can process them concurrently.
const jobs = [];
for (const block of picker.blocks ?? []) {
  for (const villa of block.villas ?? []) {
    const villaKey = `${block.code} · ${villa.label ?? "Villa " + villa.number}`;
    for (const ms of villa.milestones ?? []) {
      jobs.push({ villaKey, sectionName: ms.section?.name ?? "(unnamed section)", milestoneId: ms.id });
    }
  }
}
const totalVillas = new Set(jobs.map((j) => j.villaKey)).size;
const totalMilestones = jobs.length;
console.log(`Auditing ${totalMilestones} milestones across ${totalVillas} villas...\n`);

// Fetch in parallel batches to keep the wall-clock reasonable without
// hammering the endpoint.
const BATCH = 20;
const emptyByVilla = new Map();
let done = 0;
let emptyMilestones = 0;

for (let i = 0; i < jobs.length; i += BATCH) {
  const batch = jobs.slice(i, i + BATCH);
  const counts = await page.evaluate(async ({ base, pid, ids }) => {
    return Promise.all(
      ids.map((mid) =>
        fetch(`${base}/api/projects/${pid}/activities/for-milestone/${mid}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((d) => (d.activities ?? []).length)
          .catch(() => -1),
      ),
    );
  }, { base: BASE, pid: project.id, ids: batch.map((j) => j.milestoneId) });
  batch.forEach((job, idx) => {
    const c = counts[idx];
    if (c === 0) {
      emptyMilestones++;
      const arr = emptyByVilla.get(job.villaKey) ?? [];
      arr.push(job.sectionName);
      emptyByVilla.set(job.villaKey, arr);
    }
  });
  done += batch.length;
  process.stderr.write(`  ${done}/${totalMilestones} milestones checked\r`);
}
process.stderr.write("\n\n");

await browser.close();

console.log(`Villas with at least one empty milestone (${emptyByVilla.size} of ${totalVillas}):\n`);
const sortedVillas = [...emptyByVilla.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
for (const [villa, sections] of sortedVillas) {
  console.log(`  ${villa}`);
  for (const s of sections) console.log(`      · ${s}`);
}
console.log(`\nTotal: ${emptyMilestones} empty of ${totalMilestones} milestones across ${totalVillas} villas.`);
