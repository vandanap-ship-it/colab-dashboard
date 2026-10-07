/**
 * Fold a villa that is really the second half of an MSP pair into the pair
 * record, e.g. Villa 4 → Villa 3 (Villa 3 has unitCount 2 = Villa 3 & 4).
 *
 *   DATABASE_URL="postgresql://..." \
 *   PROJECT_NAME="Amanvana" \
 *   FROM_VILLA=4 \
 *   npx tsx scripts/fold-paired-villa.ts
 *
 * Dry run by default: prints every row that points at the villa. APPLY=1
 * (plus ALLOW_VILLA_FOLD=1 on Neon) moves those rows onto the pair record
 * and deletes the folded villa, in one transaction.
 *
 * Why: Villa pairing follows the MSP (Shraddha, 2026-10-07). Villa 4 was
 * created on 2026-10-01 (scripts/fix-villa4-and-hindrance.ts) to hold six
 * Colab Issues, but the MSP already schedules it inside Villa 3, so it was
 * double-counted (Siddhi showed 94 units against 93).
 *
 * Every table with a "villaId" column is discovered from the live schema
 * rather than hard-coded, so tables added later are moved too. A villa
 * that owns VillaMilestone rows is refused — those carry a schedule and
 * would collide with the pair's own milestones.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const apply = process.env.APPLY === "1";
if (apply && /neon\.tech/i.test(url) && process.env.ALLOW_VILLA_FOLD !== "1") {
  console.error("Refusing: set ALLOW_VILLA_FOLD=1 to write to Neon.");
  process.exit(1);
}
const projectName = process.env.PROJECT_NAME ?? "Amanvana";
const fromNumber = Number(process.env.FROM_VILLA);
if (!Number.isInteger(fromNumber) || fromNumber < 2) {
  console.error("FROM_VILLA must be the villa number to fold away, e.g. FROM_VILLA=4");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// Table names come from information_schema, never from user input, but
// quote them anyway since Prisma model tables are mixed-case.
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function main() {
  const project = await prisma.project.findFirst({
    where: { name: projectName },
    select: { id: true, name: true },
  });
  if (!project) {
    console.error(`Project not found: "${projectName}"`);
    process.exit(1);
  }
  const [from, into] = await Promise.all(
    [fromNumber, fromNumber - 1].map((number) =>
      prisma.villa.findUnique({
        where: { projectId_number: { projectId: project.id, number } },
        select: { id: true, number: true, label: true, unitCount: true },
      }),
    ),
  );
  console.log(`Project: ${project.name} (${project.id})`);
  if (!from) {
    console.log(`Villa ${fromNumber} doesn't exist — nothing to fold.`);
    return;
  }
  if (!into || into.unitCount < 2) {
    console.error(`Refusing: Villa ${fromNumber - 1} is not an MSP pair (needs unitCount 2, has ${into?.unitCount ?? "no villa"}).`);
    process.exit(1);
  }
  console.log(`Fold Villa ${from.number} (${from.id}) → Villa ${into.number} "${into.label ?? `Villa ${into.number}`}" (${into.id}, unitCount ${into.unitCount})`);

  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'villaId'
      ORDER BY table_name`,
  );
  const counts: Array<{ table: string; rows: number }> = [];
  for (const { table_name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM ${q(table_name)} WHERE "villaId" = $1`,
      from.id,
    );
    counts.push({ table: table_name, rows: Number(n) });
  }
  console.log("\nRows pointing at the villa being folded:");
  for (const c of counts) console.log(`  ${c.table.padEnd(22)} ${c.rows}`);

  const milestones = counts.find((c) => c.table === "VillaMilestone")?.rows ?? 0;
  if (milestones > 0) {
    console.error(`\nRefusing: Villa ${from.number} has ${milestones} VillaMilestone row(s) — it carries its own schedule. Resolve by hand.`);
    process.exit(1);
  }
  const toMove = counts.filter((c) => c.rows > 0);

  if (!apply) {
    console.log(`\nDry run only — nothing written. APPLY=1 moves ${toMove.reduce((n, c) => n + c.rows, 0)} row(s) and deletes Villa ${from.number}.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const c of toMove) {
      const moved = await tx.$executeRawUnsafe(
        `UPDATE ${q(c.table)} SET "villaId" = $1 WHERE "villaId" = $2`,
        into.id, from.id,
      );
      console.log(`  moved ${moved} ${c.table} row(s)`);
    }
    await tx.villa.delete({ where: { id: from.id } });
  });
  console.log(`\nDone: Villa ${from.number} folded into Villa ${into.number}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
