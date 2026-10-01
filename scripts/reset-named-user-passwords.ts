/**
 * One-off: set a unique password for each of the 8 named-user accounts
 * on Siddhi. Each user's password is {firstname}wl (first name from the
 * login ID + the "wl" suffix for White Lotus).
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
 * credential. Using {firstname}wl keeps the scheme easy to recall and
 * visibly distinct from the login ID (which uses firstname.surname).
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

// {firstname}wl pattern — first segment of the login ID + "wl" suffix.
const USERS: Array<{ username: string; password: string; module: string }> = [
  // Progress
  { username: "harish.bs",     password: "harishwl",     module: "Progress" },
  { username: "samarth.p",     password: "samarthwl",    module: "Progress" },
  // QA / QC
  { username: "thangamani.g",  password: "thangamaniwl", module: "QA/QC" },
  { username: "nagarjuna.c",   password: "nagarjunawl",  module: "QA/QC" },
  { username: "harshit.g",     password: "harshitwl",    module: "QA/QC" },
  // Safety
  { username: "girish.r",      password: "girishwl",     module: "Safety" },
  { username: "abhishek.m",    password: "abhishekwl",   module: "Safety" },
  { username: "mohd.asif",     password: "mohdwl",       module: "Safety" },
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
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.update({
      where: { id: exists.id },
      data: { passwordHash },
    });
    console.log(`  ~ ${u.username} (${exists.name}, ${u.module}) → ${u.password}`);
    reset++;
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(`Passwords reset: ${reset} / ${USERS.length}`);
  if (notFound > 0) console.log(`Not found:       ${notFound}`);
  console.log("=".repeat(60));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
