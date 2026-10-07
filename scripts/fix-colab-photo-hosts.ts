/**
 * Repairs Colab-imported progress photos. Dry run unless APPLY=1.
 *
 *   DATABASE_URL="postgresql://..." PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/fix-colab-photo-hosts.ts
 *
 * Colab's day-by-day log exports photo links on kalpataru-api.colabtools.com,
 * which redirect to a CDN that answers 403; the same file path on
 * node.colabtools.com loads (verified 2026-10-07). The 2026-10-07 daily-log
 * import stored those broken links, and because the snapshot import had
 * already stored the same files under node.colabtools.com, 299 entries got
 * the same photo twice.
 *
 * For every photo on a Colab upload path this rewrites the URL onto
 * node.colabtools.com, then keeps ONE photo per (entry, file): the one
 * already on the working host if any, else the oldest. Extra rows are
 * deleted — they point at the same remote file, so no image is lost.
 * APPLY=1 (plus ALLOW_PHOTO_FIX=1 on Neon) writes, in one transaction.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const apply = process.env.APPLY === "1";
if (apply && /neon\.tech/i.test(url) && process.env.ALLOW_PHOTO_FIX !== "1") {
  console.error("Refusing: set ALLOW_PHOTO_FIX=1 to write to Neon.");
  process.exit(1);
}
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const BASE = "https://node.colabtools.com/";
const COLAB_UPLOAD = /^https?:\/\/[^/]*colabtools\.com\/uploads\//;

async function main() {
  const project = await prisma.project.findFirst({ where: { name: projectName }, select: { id: true, name: true } });
  if (!project) { console.error(`Project not found: "${projectName}"`); process.exit(1); }
  console.log(`Project: ${project.name}`);
  console.log(apply ? "Mode: APPLY — writing" : "Mode: DRY RUN — nothing will be written (add APPLY=1 to write)");

  const photos = await prisma.progressPhoto.findMany({
    where: { progressEntry: { projectId: project.id }, url: { contains: "colabtools.com/uploads/" } },
    select: { id: true, progressEntryId: true, url: true, uploadedAt: true },
    orderBy: { uploadedAt: "asc" },
  });
  const hosts = new Map<string, number>();
  for (const p of photos) {
    const h = p.url.split("/uploads/")[0];
    hosts.set(h, (hosts.get(h) ?? 0) + 1);
  }
  console.log(`\nColab photos: ${photos.length}`);
  for (const [h, n] of hosts) console.log(`  ${h}  ${n}${h + "/" === BASE ? "  (working)" : ""}`);

  const groups = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!COLAB_UPLOAD.test(p.url)) continue;
    const canonical = BASE + p.url.slice(p.url.indexOf("/uploads/") + 1);
    const k = `${p.progressEntryId}|${canonical}`;
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  const rewrites: Array<{ id: string; url: string }> = [];
  const deletes: string[] = [];
  for (const [k, g] of groups) {
    const canonical = k.slice(k.indexOf("|") + 1);
    const keep = g.find((p) => p.url === canonical) ?? g[0];
    if (keep.url !== canonical) rewrites.push({ id: keep.id, url: canonical });
    for (const p of g) if (p.id !== keep.id) deletes.push(p.id);
  }
  const entriesWithDupes = [...groups.values()].filter((g) => g.length > 1).length;
  console.log(`\nLinks to move onto the working host: ${rewrites.length}`);
  console.log(`Duplicate photo rows to remove: ${deletes.length} (on ${entriesWithDupes} entr${entriesWithDupes === 1 ? "y" : "ies"})`);
  console.log(`Photos after repair: ${photos.length - deletes.length}, all on ${BASE}`);

  if (!apply) { console.log("\nDry run only — nothing written."); return; }
  await prisma.$transaction(async (tx) => {
    if (deletes.length) await tx.progressPhoto.deleteMany({ where: { id: { in: deletes } } });
    for (const r of rewrites) await tx.progressPhoto.update({ where: { id: r.id }, data: { url: r.url } });
  }, { timeout: 120_000 });
  console.log(`\nDone: ${rewrites.length} link(s) moved, ${deletes.length} duplicate(s) removed.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
