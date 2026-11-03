/**
 * Dry-run for the EOD reminder cron: look up Harish + Sampath by name
 * prefix, show their email + active flag + today's log count, so Vandana
 * can see whether the 17:20 cron will actually be able to reach them.
 *
 *   unset DATABASE_URL && npx tsx --env-file=.env.local \
 *     scripts/check-eod-reminder-targets.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { istDayStart } from "../src/lib/istDay";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const TARGET_NAMES = ["Harish", "Sampath"];

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: TARGET_NAMES.map((n) => ({ name: { startsWith: n, mode: "insensitive" as const } })),
    },
    select: { id: true, name: true, email: true, active: true },
  });

  console.log(`\nMatched ${users.length} user(s) for TARGET_NAMES=${TARGET_NAMES.join(", ")}\n`);
  if (users.length === 0) {
    console.log("  (nobody matched — the cron will silently no-op)");
    await prisma.$disconnect();
    return;
  }

  const today = istDayStart();
  console.log(`Today IST: ${today.toISOString().slice(0, 10)}\n`);
  console.log(`Name                     Active  Email                                 Logged today`);
  console.log(`${"-".repeat(90)}`);
  for (const u of users) {
    const [p, m] = await Promise.all([
      prisma.progressEntry.count({ where: { createdById: u.id, date: { gte: today } } }),
      prisma.manpowerEntry.count({ where: { createdById: u.id, entryDate: { gte: today } } }),
    ]);
    const loggedTag = p + m === 0 ? "none  → would reminder" : `${p}P + ${m}M → skip`;
    console.log(
      `${u.name.padEnd(24)} ${(u.active ? "yes" : "NO").padEnd(7)} ${(u.email ?? "(no email)").padEnd(36)} ${loggedTag}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
