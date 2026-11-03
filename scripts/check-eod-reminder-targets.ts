/**
 * Dry-run for the EOD reminder cron. For each configured owner (Sampath →
 * A&T, Harish → Elegant), prints:
 *   - whether we matched the user and whether they have an email
 *   - which contractors matched the pattern
 *   - today's progress + manpower counts across those contractors
 *   - what the cron WOULD do at 17:20 IST (reminder vs skip)
 *
 *   unset DATABASE_URL && PROJECT_NAME="Amanvana" \
 *     npx tsx --env-file=.env.local scripts/check-eod-reminder-targets.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { istDayStart } from "../src/lib/istDay";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Must stay in sync with OWNERSHIP in
// src/app/api/cron/eod-progress-reminder/route.ts
const OWNERSHIP = [
  { userNamePrefix: "Sampath", contractorPatterns: ["A&T", "A & T"] },
  { userNamePrefix: "Harish",  contractorPatterns: ["Elegant", "Elegent"] },
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

  const today = istDayStart();
  console.log(`\nProject: ${project.name}`);
  console.log(`Today IST: ${today.toISOString().slice(0, 10)}\n`);

  for (const owner of OWNERSHIP) {
    console.log(`─── Owner: ${owner.userNamePrefix} ───`);
    const user = await prisma.user.findFirst({
      where: {
        active: true,
        name: { startsWith: owner.userNamePrefix, mode: "insensitive" as const },
      },
      select: { id: true, name: true, email: true, active: true },
    });
    if (!user) {
      console.log(`  ✗ No active user matched "${owner.userNamePrefix}". The cron will skip them.`);
      console.log();
      continue;
    }
    console.log(`  User:    ${user.name}  ·  email: ${user.email ?? "(none)"}`);

    const contractors = await prisma.contractor.findMany({
      where: {
        projectId: project.id,
        OR: owner.contractorPatterns.map((p) => ({
          name: { contains: p, mode: "insensitive" as const },
        })),
      },
      select: { id: true, name: true },
    });
    if (contractors.length === 0) {
      console.log(
        `  ✗ No contractor matched patterns ${JSON.stringify(owner.contractorPatterns)}. ` +
          `Update OWNERSHIP in the cron.`,
      );
      console.log();
      continue;
    }
    console.log(`  Contractors (${contractors.length}): ${contractors.map((c) => c.name).join(", ")}`);

    const contractorIds = contractors.map((c) => c.id);
    const [progressToday, manpowerToday] = await Promise.all([
      prisma.progressEntry.count({
        where: { contractorId: { in: contractorIds }, date: { gte: today }, deletedAt: null },
      }),
      prisma.manpowerEntry.count({
        where: { contractorId: { in: contractorIds }, entryDate: { gte: today }, deletedAt: null },
      }),
    ]);
    const covered = progressToday + manpowerToday > 0;
    console.log(`  Today:   ${progressToday} progress + ${manpowerToday} manpower  → ${covered ? "✓ covered, no email" : "✗ EMPTY, would email"}`);
    if (!covered && !user.email) {
      console.log(`           ⚠ user has no email on file; the cron will log no-email and send nothing.`);
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
