/**
 * One-off: ensure Madhavan (Madhavarajan Soundararajan) has a working
 * Siddhi login for the Progress module. Mirrors Harish's shape (role,
 * modules, canApproveWorkPermits) and uses the standard
 * {firstname}wl password pattern.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_USER_CREATE=1 \
 *   npx tsx scripts/activate-madhavan.ts
 *
 * Idempotent — if madhavarajan.s already exists, this just refreshes
 * his active flag, modules, designation, and password. Won't create a
 * duplicate.
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (/neon\.tech/i.test(url) && process.env.ALLOW_USER_CREATE !== "1") {
  console.error("Refusing to run against Neon without ALLOW_USER_CREATE=1.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const USERNAME = "madhavarajan.s";
const NAME     = "Madhavarajan Soundararajan";
const EMAIL    = "madhavarajan.s@whitelotusgroup.in";
const PASSWORD = "madhavarajanwl"; // {firstname}wl pattern

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Mirror Harish's role / modules / permit-approver flag so Madhavan
  // sits in the same bucket as the other Progress-side user.
  const harish = await prisma.user.findUnique({
    where: { username: "harish.bs" },
    select: { role: true, modules: true, canApproveWorkPermits: true },
  });
  if (!harish) {
    console.error("Can't mirror Harish — harish.bs not found.");
    process.exit(1);
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username: USERNAME },
        { name: { contains: "Madhavarajan", mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, name: true, active: true },
  });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        active: true,
        role: harish.role,
        modules: harish.modules,
        canApproveWorkPermits: harish.canApproveWorkPermits,
        designation: "Assistant Manager - Execution",
        email: EMAIL,
        passwordHash,
      },
      select: { id: true, username: true, name: true, active: true, modules: true },
    });
    console.log(`  ~ ${existing.username} (${existing.name}) refreshed:`);
    console.log(JSON.stringify(updated, null, 2));
  } else {
    const created = await prisma.user.create({
      data: {
        username: USERNAME,
        name: NAME,
        email: EMAIL,
        passwordHash,
        role: harish.role,
        modules: harish.modules,
        canApproveWorkPermits: harish.canApproveWorkPermits,
        designation: "Assistant Manager - Execution",
        active: true,
      },
      select: { id: true, username: true, name: true },
    });
    console.log(`  + ${created.username} (${created.name}) created`);
    console.log(`    id=${created.id}`);
  }

  console.log("");
  console.log(`Login:    ${USERNAME}`);
  console.log(`Password: ${PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
