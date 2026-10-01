/**
 * One-off: set a unique password for each of the 8 named-user accounts
 * on Siddhi. Each user's password matches their own login ID.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_PASSWORD_RESET=1 \
 *   npx tsx scripts/reset-named-user-passwords.ts
 *
 * Idempotent — re-running sets the same hash again, no harm done. If a
 * username doesn't exist, it's reported but doesn't fail the batch.
 *
 * Rationale (Shraddha 2026-10-01): the earlier shared password `Wlg123`
 * was convenient for seeding but every real user should have a unique
 * credential. Using the login ID as the password keeps the scheme easy
 * to recall and to communicate per-user.
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_PASSWORD_RESET !== "1") {
  console.error("Refusing to run against Neon without ALLOW_PASSWORD_RESET=1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Password = login ID for each named user, per Shraddha's 2026-10-01 call.
const USERS: Array<{ username: string; module: string }> = [
  // Progress
  { username: "harish.bs",     module: "Progress" },
  { username: "samarth.p",     module: "Progress" },
  // QA / QC
  { username: "thangamani.g",  module: "QA/QC" },
  { username: "nagarjuna.c",   module: "QA/QC" },
  { username: "harshit.g",     module: "QA/QC" },
  // Safety
  { username: "girish.r",      module: "Safety" },
  { username: "abhishek.m",    module: "Safety" },
  { username: "mohd.asif",     module: "Safety" },
];

async function main() {
  let reset = 0;
  let notFound = 0;
  for (const u of USERS) {
    const exists = await prisma.user.findUnique({
      where: { username: u.username },
      select: { id: true, name: true },
    });
    if (!exists) {
      console.warn(`  ! ${u.username} not found — skipped`);
      notFound++;
      continue;
    }
    const passwordHash = await bcrypt.hash(u.username, 10);
    await prisma.user.update({
      where: { id: exists.id },
      data: { passwordHash },
    });
    console.log(`  ~ ${u.username} (${exists.name}, ${u.module}) → password set to login ID`);
    reset++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Passwords reset: ${reset} / ${USERS.length}`);
  if (notFound > 0) console.log(`Not found:       ${notFound}`);
  console.log("=".repeat(60));
  console.log("Each user's password is now the same as their login ID.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
