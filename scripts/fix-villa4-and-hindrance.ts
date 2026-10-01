/**
 * One-off: creates Villa 4 (missing from Siddhi's Amanvana setup, caught
 * by the 2026-10-01 Issue import leaving 6 observations unlinked), then
 * backfills those 6 Issues' villaId. Also reassigns the single
 * imported hindrance (`colab-hindrance:728`) from the fallback-picked
 * Prashanth Y to Harish BS (DPM - Projects) per Shraddha.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_VILLA4_FIX=1 \
 *   PROJECT_NAME="Amanvana" \
 *   npx tsx scripts/fix-villa4-and-hindrance.ts
 *
 * Idempotent — re-running leaves Villa 4 alone if it already exists.
 * Issue updates use the known idempotency keys from the Colab import
 * so only those 6 rows are touched.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_VILLA4_FIX !== "1") {
  console.error("Refusing to run: set ALLOW_VILLA4_FIX=1 to run against Neon.");
  process.exit(1);
}

const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Idempotency keys for the 6 Issues raised against Villa 04 in Colab's
// 2026-10-01 export (identified by CSV row inspection).
const VILLA4_ISSUE_KEYS = [
  "colab-issue:110321",
  "colab-issue:110346-638142",
  "colab-issue:110346-638143",
  "colab-issue:111928-642364",
  "colab-issue:111928-642365",
  "colab-issue:111928-642366",
];

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }
  console.log(`Project: ${project.name} (${project.id})`);

  // 1. Create Villa 4 if missing.
  let villa4 = await prisma.villa.findFirst({
    where: { projectId: project.id, number: 4 },
    select: { id: true, number: true, blockId: true },
  });
  if (villa4) {
    console.log(`Villa 4 already exists · id=${villa4.id} · blockId=${villa4.blockId}`);
  } else {
    // Pick a block to attach Villa 4 to. Prefer the block that already
    // contains Villa 3 or 5 (adjacent numbering); fall back to the block
    // with the fewest villas; final fallback is the first block by
    // createdAt. The site team can always re-parent later via admin UI.
    const neighbour = await prisma.villa.findFirst({
      where: { projectId: project.id, number: { in: [3, 5, 1, 2] } },
      orderBy: { number: "asc" },
      select: { blockId: true, number: true },
    });
    let blockId: string | null = neighbour?.blockId ?? null;
    if (blockId) {
      console.log(`Using neighbour-of Villa ${neighbour!.number}'s block (${blockId})`);
    } else {
      const anyBlock = await prisma.block.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });
      if (!anyBlock) {
        console.error("No blocks exist on this project; create one before adding Villa 4.");
        process.exit(1);
      }
      blockId = anyBlock.id;
      console.log(`No neighbour villa — using first block "${anyBlock.name}" (${anyBlock.id})`);
    }

    villa4 = await prisma.villa.create({
      data: {
        projectId: project.id,
        blockId,
        number: 4,
        inScope: true,
        unitCount: 1,
      },
      select: { id: true, number: true, blockId: true },
    });
    console.log(`  + Villa 4 created · id=${villa4.id}`);
  }

  // 2. Backfill villaId on the 6 Issues known to reference Villa 04.
  const backfill = await prisma.issue.updateMany({
    where: {
      projectId: project.id,
      idempotencyKey: { in: VILLA4_ISSUE_KEYS },
      villaId: null,
    },
    data: { villaId: villa4.id },
  });
  console.log(`Backfilled villaId on ${backfill.count} Issues (expected ≤ 6).`);

  // 3. Reassign the single imported hindrance to Harish BS.
  const harish = await prisma.user.findFirst({
    where: {
      active: true,
      OR: [
        { name: { equals: "Harish BS", mode: "insensitive" } },
        { name: { contains: "Harish B", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, username: true },
  });
  if (!harish) {
    console.error("Couldn't resolve Harish BS. Hindrance left as-is.");
  } else {
    console.log(`Harish BS resolved · ${harish.username} (${harish.id})`);
    const reassigned = await prisma.hindrance.updateMany({
      where: {
        projectId: project.id,
        idempotencyKey: "colab-hindrance:728",
      },
      data: { createdById: harish.id },
    });
    console.log(`Reassigned ${reassigned.count} hindrance(s) to Harish.`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Done.");
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
