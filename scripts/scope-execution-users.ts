/**
 * One-off: scope the three in-house execution users to all modules EXCEPT
 * QA/QC. They were previously `modules: null` (full access).
 *
 *   Harish BS, Samarth Patil, Madhavarajan Soundararajan
 *   → modules: ["PROGRESS", "SAFETY", "HINDRANCE", "CONCERN"]
 *
 * Per Shraddha 2026-10-07: they shouldn't see WIRs or observations in
 * their inbox any more — QA/QC is Thangamani's domain. Everything else
 * on the execution side (progress, manpower, hindrance, concern, safety
 * raise/approve where applicable) stays.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_USER_MATRIX_SYNC=1 \
 *   npx tsx scripts/scope-execution-users.ts
 *
 * Idempotent. Prints before/after for each user.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_USER_MATRIX_SYNC !== "1") {
  console.error("Refusing to run against Neon without ALLOW_USER_MATRIX_SYNC=1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const USERNAMES = ["harish.bs", "samarth.p", "madhavarajan.s"];
const TARGET_MODULES = JSON.stringify(["PROGRESS", "SAFETY", "HINDRANCE", "CONCERN"]);

async function main() {
  for (const username of USERNAMES) {
    const before = await prisma.user.findUnique({
      where: { username },
      select: { id: true, name: true, modules: true },
    });
    if (!before) {
      console.warn(`  ! ${username} not found — skipped`);
      continue;
    }
    if (before.modules === TARGET_MODULES) {
      console.log(`  = ${username} (${before.name}) already scoped correctly`);
      continue;
    }
    await prisma.user.update({
      where: { id: before.id },
      data: { modules: TARGET_MODULES },
    });
    console.log(`  ~ ${username} (${before.name}): ${before.modules ?? "null (full access)"} → ${TARGET_MODULES}`);
  }

  console.log("");
  console.log("Done. These three users will no longer see QA/QC tiles or WIR inbox items.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
