/**
 * One-off: set a single named user's password from an env var.
 *
 *   DATABASE_URL="postgresql://..." \
 *   ALLOW_PASSWORD_RESET=1 \
 *   USERNAME="gladson" \
 *   NEW_PASSWORD="<the real password>" \
 *   npx tsx scripts/reset-user-password.ts
 *
 * Why this exists next to reset-named-user-passwords.ts: that script
 * holds the full named-user roster with each user's canonical
 * {firstname}wl password in source, which is fine for the batch reset
 * but makes a per-user edit noisy and triggers the credential-leakage
 * classifier when a new row is added. This one takes the password
 * through an env var instead, so nothing goes into the repo.
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

const username = process.env.USERNAME?.trim();
if (!username) {
  console.error("USERNAME env var required.");
  process.exit(1);
}

const newPassword = process.env.NEW_PASSWORD;
if (!newPassword || newPassword.length < 4) {
  console.error("NEW_PASSWORD env var required (≥4 chars).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

async function main() {
  const user = await prisma.user.findUnique({
    where: { username: username! },
    select: { id: true, name: true, active: true, contractor: { select: { name: true } } },
  });
  if (!user) {
    console.error(`! "${username}" not found.`);
    process.exit(1);
  }
  if (!user.active) {
    console.warn(`! "${username}" is deactivated — proceeding anyway so the password is ready for reactivation.`);
  }

  const passwordHash = await bcrypt.hash(newPassword!, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  console.log(`~ ${username} (${user.name}) · password reset · contractor=${user.contractor?.name ?? "none"}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
